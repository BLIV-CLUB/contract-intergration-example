import dotenv from "dotenv";
import Web3, { Contract, HttpProvider } from "web3";
import { isAddress } from "web3-validator";
import {
  FeeMarketEIP1559Transaction,
  FeeMarketEIP1559TxData,
} from "@ethereumjs/tx";
import OrderBook from "./assets/OrderBook.abi";
import Margin from "./assets/Margin.abi";

import { Common, Hardfork } from "@ethereumjs/common";
import { ProtocolVault } from "./assets/ProtocolVault.abi";
import { ERC20 } from "./assets/ERC20.abi";

dotenv.config({
  path: "./.env",
});

interface MakerTransactionData {
  makerAddress: string; // Maker Address
  price: string; // PRICE at which to LONG/SHORT
  amount: string; // Amount of SNV to LONG/SHORT
  isBuy: boolean; // Whether to LONG/SHORT MakerTransactionData
}

interface Account {
  address: string;
  mnemonic: Buffer;
}

const common = Common.custom({ chainId: 80001 }, { hardfork: Hardfork.London });

async function initWeb3() {
  let web3;
  if (process.env.RPC_ENDPOINT)
    web3 = new Web3(new HttpProvider(process.env.RPC_ENDPOINT));
  else throw new Error("Provide a valid RPC_ENDPOINT");

  /// Init Contracts
  if (
    !process.env.ORDER_BOOK_ADDRESS ||
    !process.env.MARGIN_ADDRESS ||
    !process.env.PROTOCOL_VAULT_ADDRESS
  )
    throw new Error("Please Provide Contract Address");

  let orderBook = new web3.eth.Contract(
    OrderBook,
    process.env.ORDER_BOOK_ADDRESS
  );
  let margin = new web3.eth.Contract(Margin, process.env.MARGIN_ADDRESS);

  let protocolVault = new web3.eth.Contract(
    ProtocolVault,
    process.env.PROTOCOL_VAULT_ADDRESS
  );

  if (!process.env.MAKER_ADDRESS || !isAddress(process.env.MAKER_ADDRESS))
    throw new Error("Please Provide Valid Maker Address ");

  if (!process.env.PRIVATE_KEY)
    throw new Error("Please Provide valid Private Key");

  // Add account which will send the transaction
  const addedAccount = web3.eth.accounts.wallet.add(
    process.env.PRIVATE_KEY.trim()
  );

  if (addedAccount[0].address != process.env.MAKER_ADDRESS)
    throw new Error("Invalid MNEMONIC and Maker Address differ");

  console.log(`Added Account ${addedAccount[0].address}`);

  const account: Account = {
    address: addedAccount[0].address,
    mnemonic: Buffer.from(process.env.PRIVATE_KEY.trim(), "hex"),
  };

  return { web3, account, margin, orderBook, protocolVault };
}

async function addMakerOrder(
  web3: Web3,
  account: Account,
  orderBook: Contract<typeof OrderBook>
) {
  const makerTransactionData: MakerTransactionData = {
    amount: web3.utils.toWei(0.1, "ether").toString(),
    isBuy: true,
    makerAddress: account.address,
    price: web3.utils.toWei(2, "ether").toString(),
  };

  /// Transaction Data needs to be encoded before being sent to the Blockchain the
  /// encoding follows the format
  /// Maker Address / Buy Amount / Price / isBuy
  const parameters = web3.eth.abi.encodeParameters(
    ["address", "uint256", "uint256", "bool"],
    [
      makerTransactionData.makerAddress,
      makerTransactionData.amount,
      makerTransactionData.price,
      makerTransactionData.isBuy,
    ]
  );

  const gasEstimate = await orderBook.methods
    .addMakerOrder(parameters)
    .estimateGas({
      from: account.address,
    });

  if (!gasEstimate) throw new Error(" Estimate Gas Failed ");

  const encodedParameters = orderBook.methods
    .addMakerOrder(parameters)
    .encodeABI();

  const receit = await orderBook.methods.addMakerOrder(parameters).send({
    from: account.address,
    nonce: (await web3.eth.getTransactionCount(account.address)).toString(),
  });

  console.log(`Transaction Mined with Hash : ${receit.transactionHash}`);
  /// Un-comment for a Raw Tx Approach using manual gas limits

  // // Using a raw Tx to manually specify Gas Limits
  // const rawTx: FeeMarketEIP1559TxData = {
  //   data: encodedParameters,
  //   gasLimit: gasEstimate,
  //   /// Total Max Fee that needs to be given (base + tip)
  //   /// Refer https://docs.etherscan.io/api-endpoints/gas-tracker
  //   /// for examples on how to use these
  //   // maxFeePerGas: maxFeePerGas, // Can be set to manual variables or something that is imported from Etherescan
  //   // maxPriorityFeePerGas: maxPriorityFeePerGas, // Can be set to manual variables or something that is imported from Etherescan
  //   nonce: await web3.eth.getTransactionCount(account.address),
  //   to: orderBook.options.address,
  //   type: "0x02",
  // };

  // const txObject = FeeMarketEIP1559Transaction.fromTxData(rawTx, {
  //   common: common,
  // });

  // const signedTx = txObject.sign(account.mnemonic);

  // /// If the account in the web3 wallet matches the sign on the transaction that account will be used
  // // for sending the transaction
  // await web3.eth.sendSignedTransaction("0x" + signedTx.serialize().toString());
}

/// Alternalte Method to call transaction without making raw transactoins
/// Is less reliable than the above method but will work for simpler transaction;
async function removeMakerOrder(
  web3: Web3,
  account: Account,
  orderBook: Contract<typeof OrderBook>
) {
  const makerOrderId = 123;

  const estimatedGas = await orderBook.methods
    .removeOrder(makerOrderId)
    .estimateGas();

  if (!estimatedGas) throw new Error("Cannot Estimate Gas");

  await orderBook.methods.removeOrder(makerOrderId).send({
    from: account.address,
    nonce: (await web3.eth.getTransactionCount(account.address)).toString(),
    type: "0x02", /// EIP 1559 Transaction
  });
}

async function depositMarginWETH(
  web3: Web3,
  account: Account,
  protocolVault: Contract<typeof ProtocolVault>
) {
  /// Ensure that the value is approved to the contract before depositing
  const estimatedGas = await protocolVault.methods
    .receiveDepositWETH(web3.utils.toWei("1", "ether").toString())
    .estimateGas({
      from: account.address,
    });

  if (!estimatedGas) throw new Error("Failed to Estimate Gas");

  const receit = await protocolVault.methods
    .receiveDepositWETH(web3.utils.toWei("1", "ether").toString())
    .send({
      from: account.address,
      type: "0x02",
      nonce: (await web3.eth.getTransactionCount(account.address)).toString(),
    });

  console.log(receit);
}

async function depositMarginOtherToken(
  web3: Web3,
  account: Account,
  protocolVault: Contract<typeof ProtocolVault>
) {
  const tokenAddress = "0x000000000000000000000000000000";

  const erc20 = new web3.eth.Contract(ERC20, tokenAddress);

  const approval = await erc20.methods
    .allowance(
      account.address,
      process.env.PROTOCOL_VAULT_ADDRESS
        ? process.env.PROTOCOL_VAULT_ADDRESS
        : ""
    )
    .call();

  if (approval.toString() < web3.utils.toWei(1, "ether").toString()) {
    await erc20.methods
      .approve(
        process.env.PROTOCOL_VAULT_ADDRESS
          ? process.env.PROTOCOL_VAULT_ADDRESS
          : "",
        web3.utils.toWei(1, "ether").toString()
      )
      .send({
        from: account.address,
        type: "0x02",
        nonce: (await web3.eth.getTransactionCount(account.address)).toString(),
      });
  }

  /// Use a custom address allowed on the contract for the list please refer to documentation
  const estimatedGas = await protocolVault.methods
    .receiveDepositInOtherToken(
      tokenAddress,
      web3.utils.toWei(1, "ether").toString()
    )
    .estimateGas();

  if (!estimatedGas) throw new Error("Failed to Estimate Gas");

  await protocolVault.methods
    .receiveDepositInOtherToken(
      tokenAddress,
      web3.utils.toWei("1", "ether").toString()
    )
    .send({
      from: account.address,
      type: "0x02",
      nonce: (await web3.eth.getTransactionCount(account.address)).toString(),
    });
}

async function withdrawMargin(
  web3: Web3,
  account: Account,
  margin: Contract<typeof ProtocolVault>
) {
  const estimatedGas = await margin.methods
    .withdraw(web3.utils.toWei(1, "ether").toString())
    .estimateGas();

  if (!estimatedGas) throw new Error("Failed to Estimate Gas");

  await margin.methods.withdraw(web3.utils.toWei(1, "ether").toString()).send({
    from: account.address,
    type: "0x02",
    nonce: (await web3.eth.getTransactionCount(account.address)).toString(),
  });
}

async function main() {
  const { web3, account, margin, orderBook, protocolVault } = await initWeb3();

  // await depositMarginWETH(web3, account, protocolVault);

  await addMakerOrder(web3, account, orderBook);

  // await removeMakerOrder(web3, account, orderBook);

  // await depositMarginOtherToken(web3, account, protocolVault);

  // await withdrawMargin(web3, account, protocolVault);
}

main().then((value) => {
  console.log("Finished Execution ");
});
