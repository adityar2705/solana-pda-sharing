import * as anchor from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import { Program } from "@coral-xyz/anchor";
import { PdaSharing } from "../target/types/pda_sharing";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { assert } from "chai";

describe("pda-sharing", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);


  const program = anchor.workspace.PdaSharing as Program<PdaSharing>;
  const connection = provider.connection;
  const wallet = anchor.workspace.PdaSharing.provider.wallet;

  //defining the required accounts
  const walletFake = Keypair.generate()

  const poolInsecure = Keypair.generate()
  const poolInsecureFake = Keypair.generate()

  const poolSecureFake = Keypair.generate()

  const vaultRecommended = Keypair.generate()


  //defining the types of account
  let mint : anchor.web3.PublicKey;
  let vaultInsecure : spl.Account;
  let vaultSecure: spl.Account
  let withdrawDestination: anchor.web3.PublicKey
  let withdrawDestinationFake: anchor.web3.PublicKey

  let authInsecure: anchor.web3.PublicKey
  let authInsecureBump: number

  let authSecure: anchor.web3.PublicKey
  let authSecureBump: number

  before(async() => {

    //creating a new token mint for our token pool
    mint = await spl.createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,

      //decimals of the created token
      1
    );

    //deriving the authority PDA -> that we shall pass into the instruction
    [authInsecure, authInsecureBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [mint.toBuffer()],
      program.programId
    );

    //getting the token pool vault -> it is basically an associated token account specifically for this mint and this wallet with the given auth pDA as authority
    vaultInsecure = await spl.getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mint,
      authInsecure,
      true
    );

    //create the withdraw destination account
    withdrawDestination = await spl.createAccount(
      connection,
      wallet.payer,
      mint,
      wallet.publicKey
    );

    //create the insecure withdraw destination
    withdrawDestinationFake = await spl.createAccount(
      connection,
      wallet.payer,
      mint,

      //the account who this account belongs to
      walletFake.publicKey
    )

    //confirming requesting SOL airdrop transaction
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        walletFake.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    //deiriving the secure Vault authority PDA
    [authSecure, authSecureBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [withdrawDestination.toBuffer()],
      program.programId
    )

    //getting the token pool Token Account
    vaultSecure = await spl.getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mint,
      authSecure,
      true
    )

  });

  it("Initialize the insecure token pool", async () => {
    //calling the pool initialize function
    const tx =  await program.methods
    .initializePool(authInsecureBump)
    .accounts({
      pool : poolInsecure.publicKey,
      mint : mint,

      //address is an attribute of the Associated Token Account
      vault : vaultInsecure.address,
      withdrawDestination : withdrawDestination
    })
    .signers([poolInsecure])
    .rpc();

    //minting new tokens specified by the mint account to the token account -> wallet is the authority
    await spl.mintTo(
      connection,
      wallet.payer,
      mint,
      vaultInsecure.address,
      wallet.payer,
      100
    );

    //check the balance of the account -> by getting the account specified by the vault address
    //getAccount fetches the current state of the account on the blockchain while the vaultInsecure is the local version
    const account = await spl.getAccount(
      connection,

      //lets get the Vault's account -> to check the balance
      vaultInsecure.address
    );

    console.log("✅Transaction was successful.");
    expect(Number(account.amount)).to.equal(100);
  });

  it("Withdraws the tokens", async() => {
    //calling the insecure withdraw tokens function
    await program.methods
      .withdrawInsecure()
      .accounts({
        pool: poolInsecure.publicKey,
        vault: vaultInsecure.address,
        withdrawDestination: withdrawDestination,
        authority: authInsecure,
      })
      .rpc()

    //get the latest data from the blockchain
    const account = await spl.getAccount(connection, vaultInsecure.address)
    expect(Number(account.amount)).to.equal(0)
  });

  it("Insecure initialize allows pool to be initialized with wrong vault", async () => {
   //we call the function to create a new fake pool with the same vault address and a new withdraw destination
    await program.methods
      .initializePool(authInsecureBump)
      .accounts({
        pool: poolInsecureFake.publicKey,
        mint: mint,
        vault: vaultInsecure.address,
        withdrawDestination: withdrawDestinationFake,
        payer: walletFake.publicKey,
      })
      //wallet fake is a payer and a signer here
      .signers([walletFake, poolInsecureFake])
      .rpc()

      //set a timeout of 1s
    await new Promise((x) => setTimeout(x, 1000))

    //mint some tokens to the insecure vault
    await spl.mintTo(
      connection,
      wallet.payer,
      mint,
      vaultInsecure.address,
      wallet.payer,
      100
    )

    //get the token account and check the balance
    const account = await spl.getAccount(connection, vaultInsecure.address)
    expect(Number(account.amount)).to.equal(100)
  })

  it("Insecure withdraw allows stealing from vault", async () => {
    //calling the insecure withdraw to get our tokens to the fake wallet
    await program.methods
      .withdrawInsecure()
      .accounts({
        pool: poolInsecureFake.publicKey,
        vault: vaultInsecure.address,
        withdrawDestination: withdrawDestinationFake,
        authority: authInsecure,
        signer: walletFake.publicKey,
      })
      .signers([walletFake])
      .rpc()

      //check the balance
    const account = await spl.getAccount(connection, vaultInsecure.address)
    expect(Number(account.amount)).to.equal(0)
  })

  it("secure pool initialization and withdraw works", async () => {
    const withdrawDestinationAccount = await spl.getAccount(
      connection,
      //putting the address
      withdrawDestination
    );

    //call the secure initialize method
    await program.methods
      .initializePoolSecure()
      .accounts({
        pool: authSecure,
        mint: mint,
        vault: vaultRecommended.publicKey,
        withdrawDestination: withdrawDestination,
      })
      .signers([vaultRecommended])
      .rpc()

    await new Promise((x) => setTimeout(x, 1000))

    //mint some tokens to the vault recommended account
    await spl.mintTo(
      connection,
      wallet.payer,
      mint,
      vaultRecommended.publicKey,
      wallet.payer,
      100
    )

    //try to withdraw the tokens to the secure destination
    await program.methods
      .withdrawSecure()
      .accounts({
        pool: authSecure,
        vault: vaultRecommended.publicKey,
        withdrawDestination: withdrawDestination,
      })
      .rpc()

    //get the state of account after the withdrawal
    const afterAccount = await spl.getAccount(
      provider.connection,
      withdrawDestination
    )

    expect(
      Number(afterAccount.amount) - Number(withdrawDestinationAccount.amount)
    ).to.equal(100)
  })

  it("Doesn't allow withdraw to the wrong destination wallet", async () => {
    try{
      //try to withdraw to the fake wallet
      await program.methods
      .withdrawSecure()
      .accounts({
        pool : authSecure,
        vault : vaultRecommended.publicKey,
        withdrawDestination : withdrawDestinationFake
      })
      .rpc();

      assert.fail("expected error");
    }catch(error){
      expect(error);
    }
  })

  it("Secure pool initialization doesn't wrong vault account", async() => {
    try{
      await program.methods
      .initializePoolSecure()
      .accounts({
        pool : authSecure,

        //using our mint created using Anchor SPL tokens
        mint : mint,

        //vault insecure doesnot have withdraw destination as the PDA
        vault : vaultInsecure.address,
        withdrawDestination : withdrawDestination
      })
      .signers([vaultRecommended])
      .rpc();

      assert.fail("expected error");
    }catch(error){
      expect(error);
    }
  });
});
