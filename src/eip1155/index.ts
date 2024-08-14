import {Transfer, Holding, CollectionHolding} from "../../generated/schema";

import {TransferSingle as TransferEvent, TransferBatch as TransferBatchEvent} from "../../generated/IERC1155/Contract1155";

import {fetchRegistry, fetchToken} from "../utils/erc1155";

import {constants} from "../graphprotocol-utils";

import {store, BigInt, ethereum, Address, Bytes} from "@graphprotocol/graph-ts";
import {getOrCreateAccount} from "../utils/entity-factory";

const IGNORE_CONTRACT_ADDRESSES = [
  "0xe0427d3a6a1cde18e0d697e20c71b0c86ee0bc4c", //base seplia
  "0xd17528b58Ba1D1E3DDdC48B1cE3B892049889c93", // eth sepolia
  "0xaBe3b6b8EEDeB953046e3C5E83FbCE0cF9625E64" // eth sepolia
];

function isIgnoredAddress(address: string): boolean {
  return IGNORE_CONTRACT_ADDRESSES.includes(address);
}

export function handleTransferSingle(event: TransferEvent): void {
  if (event.params.from.toHexString() == constants.ADDRESS_ZERO
  && isIgnoredAddress(event.address.toHexString())) {
    return;
  }
  transfer(
    event.address,
    event.params.from,
    event.params.to,
    event.params.value,
    event.params.id,
    event.block,
    event.logIndex,
    event.transaction.hash,
    0
  );
}

export function handleTransferBatch(event: TransferBatchEvent): void {
  if (event.params.from.toHexString() == constants.ADDRESS_ZERO
  && isIgnoredAddress(event.address.toHexString())) {
    return;
  }
  for (let index = 0; index < event.params.ids.length; index++) {
    transfer(
      event.address,
      event.params.from,
      event.params.to,
      event.params.values[index],
      event.params.ids[index],
      event.block,
      event.logIndex,
      event.transaction.hash,
      index
    );
  }
}

function transfer(
  address: Address,
  from: Address,
  to: Address,
  value: BigInt,
  id: BigInt,
  block: ethereum.Block,
  logIndex: BigInt,
  hash: Bytes,
  index: i32
): void {
  let collection = fetchRegistry(address);

  //Get the NFT
  let token = fetchToken(collection, id);

  // Get Sender and Receiver
  let senderAddress = getOrCreateAccount(from.toHexString());
  let receiverAddress = getOrCreateAccount(to.toHexString());

  //decrement token holdings for sender
  let senderHolding = Holding.load(senderAddress.id + "-" + token.id);
  if (senderHolding && senderAddress.id != "0x0000000000000000000000000000000000000000") {
    let senderTokenCountNew = senderHolding.balance.minus(value);
    senderHolding.balance = senderTokenCountNew;
    senderHolding.save();

    if (senderHolding.balance == BigInt.fromI32(0)) {
      store.remove("Holding", senderAddress.id + "-" + token.id);
    }
  }

  //decrement collecting holdings for sender
  let senderCollectionHolding = CollectionHolding.load(collection.id + "-" + senderAddress.id);
  if (senderCollectionHolding && senderAddress.id != "0x0000000000000000000000000000000000000000") {
    let senderTokenCountNew = senderCollectionHolding.balance.minus(value);
    senderCollectionHolding.balance = senderTokenCountNew;
    senderCollectionHolding.save();

    if (senderCollectionHolding.balance == BigInt.fromI32(0)) {
      store.remove("CollectionHolding", collection.id + "-" + senderAddress.id);
    }
  }

  //increment token holdings for receiver (if it doesn't exist create it)
  let receiverHolding = Holding.load(receiverAddress.id + "-" + token.id);
  if (receiverHolding && receiverAddress.id != constants.ADDRESS_ZERO) {
    let receiverTokenCountNew = receiverHolding.balance.plus(value);

    receiverHolding.balance = receiverTokenCountNew;
    receiverHolding.save();
  }
  if (!receiverHolding && receiverAddress.id != constants.ADDRESS_ZERO) {
    receiverHolding = new Holding(receiverAddress.id + "-" + token.id);
    receiverHolding.account = receiverAddress.id;
    receiverHolding.token = token.id;
    receiverHolding.balance = value;

    receiverHolding.save();
  }

  //increment collection holdings for receiver (if it doesn't exist create it)
  let receiverCollectionHolding = CollectionHolding.load(collection.id + "-" + receiverAddress.id);
  if (receiverCollectionHolding && receiverAddress.id != constants.ADDRESS_ZERO) {
    let receiverTokenCountNew = receiverCollectionHolding.balance.plus(value);

    receiverCollectionHolding.balance = receiverTokenCountNew;
    receiverCollectionHolding.save();
  }
  if (!receiverCollectionHolding && receiverAddress.id != constants.ADDRESS_ZERO) {
    receiverCollectionHolding = new CollectionHolding(collection.id + "-" + receiverAddress.id);
    receiverCollectionHolding.account = receiverAddress.id;
    receiverCollectionHolding.collection = collection.id;
    receiverCollectionHolding.balance = value;

    receiverCollectionHolding.save();
  }

  //update token's total supply on mints & burns
  if (senderAddress.id == constants.ADDRESS_ZERO) token.totalSupply = token.totalSupply.plus(value);
  if (receiverAddress.id == constants.ADDRESS_ZERO) token.totalSupply = token.totalSupply.minus(value);

  collection.save();
  token.save();

  let transferEntity = new Transfer(block.number.toString() + "-" + logIndex.toString() + "-" + index.toString());
  transferEntity.transaction = hash;
  transferEntity.token = token.id;
  transferEntity.collection = collection.id;
  transferEntity.senderAddress = senderAddress.id;
  transferEntity.receiverAddress = receiverAddress.id;
  transferEntity.blockNumber = block.number;
  transferEntity.timestamp = block.timestamp;
  transferEntity.save();
}
