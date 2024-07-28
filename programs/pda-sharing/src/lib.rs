use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("Ha5Ce7WmmqfgGzkCWFHgc36m8MUYz2zfxJj9WvTNcLmu");

#[program]
pub mod pda_sharing {
    use super::*;

    //function to initialize the pool
    pub fn initialize_pool(ctx : Context<InitializePool>, bump : u8)->Result<()>{
        //set all the data of the token pool
        ctx.accounts.pool.vault = ctx.accounts.vault.key();
        ctx.accounts.pool.mint = ctx.accounts.mint.key();
        ctx.accounts.pool.withdraw_destination = ctx.accounts.withdraw_destination.key();
        ctx.accounts.pool.bump = bump;

        Ok(())
    }

    //function to initialize the pool securely
    pub fn initialize_pool_secure(ctx : Context<InitializePoolSecure>) -> Result<()>{
        ctx.accounts.pool.vault = ctx.accounts.vault.key();
        ctx.accounts.pool.mint = ctx.accounts.mint.key();
        ctx.accounts.pool.withdraw_destination = ctx.accounts.withdraw_destination.key();

        //get the bump used to make the pool PDA -> with withdraw destination as seed
        ctx.accounts.pool.bump = *ctx.bumps.get("pool").unwrap();
        Ok(())
    }

    //insecure withdraw token function
    pub fn withdraw_insecure(ctx : Context<WithdrawTokens>) -> Result<()>{
        //this amount attribute is there in the TokenAccount
        let amount = ctx.accounts.vault.amount;

        //taking the mint account and bump as seeds
        let seeds = &[ctx.accounts.pool.mint.as_ref(), &[ctx.accounts.pool.bump]];

        //using the context which we defined using the token::Transfer instruction
        token::transfer(ctx.accounts.transfer_ctx().with_signer(&[seeds]), amount)
    }

    //secure withdraw tokens function
    pub fn withdraw_secure(ctx : Context<WithdrawTokensSecure>) -> Result<()>{
        let amount = ctx.accounts.vault.amount;
        let seeds = &[
            ctx.accounts.pool.withdraw_destination.as_ref(),
            &[ctx.accounts.pool.bump],
        ];

        //we pass seeds as a triple nested array for seeds/signers -> required by the instruction
        token::transfer(ctx.accounts.transfer_ctx().with_signer(&[seeds]), amount)
    }
}

//struct for the insecure initialize pool instruction
#[derive(Accounts)]
pub struct InitializePool<'info>{
    #[account(init, payer = payer, space = 8 + 32 + 32 + 32 + 1)]
    pub pool : Account<'info, TokenPool>,

    //the mint for this specific SPL token
    pub mint : Account<'info, Mint>,
    pub vault: Account<'info, TokenAccount>,
    pub withdraw_destination: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

//struct for the secure initialize pool instruction
#[derive(Accounts)]
pub struct InitializePoolSecure<'info>{
    //taking the withdraw destination as seed to ensure security
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 32 + 1,
        seeds = [withdraw_destination.key().as_ref()],
        bump
    )]
    pub pool : Account<'info, TokenPool>,
    pub mint : Account<'info, Mint>,

    //creating the Vault using backend instead of creating on the frontend
    #[account(
        init, 
        payer = payer,
        token::mint = mint,
        token::authority = pool
    )]
    pub vault : Account<'info, TokenAccount>,
    pub withdraw_destination: Account<'info, TokenAccount>,

    //required accounts for the instruction
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

//struct for the withdraw tokens instruction
#[derive(Accounts)]
pub struct WithdrawTokens<'info>{
    #[account(has_one = vault, has_one = withdraw_destination)]
    //to get the specific token pool account
    pool : Account<'info, TokenPool>,

    //the token account (vault) that stores the SPL tokens to withdraw
    #[account(mut)]
    vault : Account<'info, TokenAccount>,
    
    //withdraw destination token account
    #[account(mut)]
    withdraw_destination: Account<'info, TokenAccount>,

    /// CHECK: PDA
    authority: UncheckedAccount<'info>,
    signer : Signer<'info>,
    token_program: Program<'info, Token>,
}

//struct for securely withdrawing the tokens from the pool
#[derive(Accounts)]
pub struct WithdrawTokensSecure<'info> {
    //to get the exact token pool PDA with the same bump
    #[account(
        has_one = vault,
        has_one = withdraw_destination,
        seeds = [withdraw_destination.key().as_ref()],
        bump = pool.bump
    )]
    pub pool : Account<'info, TokenPool>,

    //vault account
    #[account(mut)]
    vault: Account<'info, TokenAccount>,

    //required accounts
    #[account(mut)]
    withdraw_destination: Account<'info, TokenAccount>,
    token_program: Program<'info, Token>,
}

//implement the transfer ctx for secure withdrawal for WithdrawTokensSecure
impl<'info> WithdrawTokensSecure<'info>{
    pub fn transfer_ctx(&self) -> CpiContext<'_,'_,'_,'info,token::Transfer<'info>>{
        let program = self.token_program.to_account_info();
        let accounts = token::Transfer{
            from : self.vault.to_account_info(),
            to : self.withdraw_destination.to_account_info(),
            authority: self.pool.to_account_info()
        };

        //return this as the context for the token transfer -> with the program and the accounts required for the instruction -> Transfer is the context struct for the transfer instruction
        CpiContext::new(program, accounts)
    }
}

//implement the transfer ctx for the tokens for WithdrawTokens
impl<'info> WithdrawTokens<'info>{
    //takes a ref to self as argument CpiContext<'a, 'b, 'c, 'info, T>, T -> type of instruction being called
    pub fn transfer_ctx(&self) -> CpiContext<'_,'_,'_,'info,token::Transfer<'info>>{
        let program = self.token_program.to_account_info();
        let accounts = token::Transfer{
            from : self.vault.to_account_info(),
            to : self.withdraw_destination.to_account_info(),
            authority : self.authority.to_account_info()
        };

        //returns this value -> ; is not put
        CpiContext::new(program , accounts)
    }
}

//struct for the token pool of a specific mint -> with a fixed withdraw_destination
#[account]
pub struct TokenPool{
    vault : Pubkey,
    mint : Pubkey,
    withdraw_destination : Pubkey,
    bump : u8
}
