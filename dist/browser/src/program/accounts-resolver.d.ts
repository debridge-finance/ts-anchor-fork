import { PublicKey } from "@solana/web3.js";
import { Idl } from "../idl.js";
import { AllInstructions } from "./namespace/types.js";
import Provider from "../provider.js";
import { AccountNamespace } from "./namespace/account.js";
declare type Accounts = {
    [name: string]: PublicKey | Accounts;
};
export declare class AccountsResolver<IDL extends Idl, I extends AllInstructions<IDL>> {
    private _accounts;
    private _provider;
    private _programId;
    private _idlIx;
    _args: Array<any>;
    static readonly CONST_ACCOUNTS: {
        associatedTokenProgram: PublicKey;
        rent: PublicKey;
        systemProgram: PublicKey;
        tokenProgram: PublicKey;
    };
    private _accountStore;
    constructor(_args: Array<any>, _accounts: Accounts, _provider: Provider, _programId: PublicKey, _idlIx: AllInstructions<IDL>, _accountNamespace: AccountNamespace<IDL>);
    args(_args: Array<any>): void;
    resolve(): Promise<void>;
    private get;
    private set;
    private resolveRelations;
    private autoPopulatePda;
    private parseProgramId;
    private toBuffer;
    private toBufferConst;
    private toBufferArg;
    private argValue;
    private toBufferAccount;
    private accountValue;
    private parseAccountValue;
    private toBufferValue;
}
export declare class AccountStore<IDL extends Idl> {
    private _provider;
    private _accounts;
    private _cache;
    constructor(_provider: Provider, _accounts: AccountNamespace<IDL>);
    fetchAccount<T = any>(publicKey: PublicKey, name?: string): Promise<T>;
}
export {};
//# sourceMappingURL=accounts-resolver.d.ts.map