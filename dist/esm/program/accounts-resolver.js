import camelCase from "camelcase";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as utf8 from "../utils/bytes/utf8.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_PROGRAM_ID } from "../utils/token.js";
import { coder } from "../spl/token";
// Populates a given accounts context with PDAs and common missing accounts.
export class AccountsResolver {
    constructor(_args, _accounts, _provider, _programId, _idlIx, _accountNamespace) {
        this._accounts = _accounts;
        this._provider = _provider;
        this._programId = _programId;
        this._idlIx = _idlIx;
        this._args = _args;
        this._accountStore = new AccountStore(_provider, _accountNamespace);
    }
    args(_args) {
        this._args = _args;
    }
    // Note: We serially resolve PDAs one by one rather than doing them
    //       in parallel because there can be dependencies between
    //       addresses. That is, one PDA can be used as a seed in another.
    //
    // TODO: PDAs need to be resolved in topological order. For now, we
    //       require the developer to simply list the accounts in the
    //       correct order. But in future work, we should create the
    //       dependency graph and resolve automatically.
    //
    async resolve() {
        for (let k = 0; k < this._idlIx.accounts.length; k += 1) {
            // Cast is ok because only a non-nested IdlAccount can have a seeds
            // cosntraint.
            const accountDesc = this._idlIx.accounts[k];
            const accountDescName = camelCase(accountDesc.name);
            // Signers default to the provider.
            if (accountDesc.isSigner && !this._accounts[accountDescName]) {
                // @ts-expect-error
                if (this._provider.wallet === undefined) {
                    throw new Error("This function requires the Provider interface implementor to have a 'wallet' field.");
                }
                // @ts-expect-error
                this._accounts[accountDescName] = this._provider.wallet.publicKey;
                continue;
            }
            // Common accounts are auto populated with magic names by convention.
            if (Reflect.has(AccountsResolver.CONST_ACCOUNTS, accountDescName) &&
                !this._accounts[accountDescName]) {
                this._accounts[accountDescName] =
                    AccountsResolver.CONST_ACCOUNTS[accountDescName];
            }
        }
        for (let k = 0; k < this._idlIx.accounts.length; k += 1) {
            // Cast is ok because only a non-nested IdlAccount can have a seeds
            // cosntraint.
            const accountDesc = this._idlIx.accounts[k];
            const accountDescName = camelCase(accountDesc.name);
            // PDA derived from IDL seeds.
            if (accountDesc.pda &&
                accountDesc.pda.seeds.length > 0 &&
                !this._accounts[accountDescName]) {
                await this.autoPopulatePda(accountDesc);
                continue;
            }
        }
        // Auto populate has_one relationships until we stop finding new accounts
        while ((await this.resolveRelations(this._idlIx.accounts)) > 0) { }
    }
    get(path) {
        // Only return if pubkey
        const ret = path.reduce((acc, subPath) => acc && acc[subPath], this._accounts);
        if (ret && ret.toBase58) {
            return ret;
        }
    }
    set(path, value) {
        let curr = this._accounts;
        path.forEach((p, idx) => {
            const isLast = idx == path.length - 1;
            if (isLast) {
                curr[p] = value;
            }
            curr[p] = curr[p] || {};
            curr = curr[p];
        });
    }
    async resolveRelations(accounts, path = []) {
        let found = 0;
        for (let k = 0; k < accounts.length; k += 1) {
            const accountDesc = accounts[k];
            const subAccounts = accountDesc.accounts;
            if (subAccounts) {
                found += await this.resolveRelations(subAccounts, [
                    ...path,
                    accountDesc.name,
                ]);
            }
            const relations = accountDesc.relations || [];
            const accountDescName = camelCase(accountDesc.name);
            const newPath = [...path, accountDescName];
            // If we have this account and there's some missing accounts that are relations to this account, fetch them
            const accountKey = this.get(newPath);
            if (accountKey) {
                const matching = relations.filter((rel) => !this.get([...path, camelCase(rel)]));
                found += matching.length;
                if (matching.length > 0) {
                    const account = await this._accountStore.fetchAccount(accountKey);
                    await Promise.all(matching.map(async (rel) => {
                        const relName = camelCase(rel);
                        this.set([...path, relName], account[relName]);
                        return account[relName];
                    }));
                }
            }
        }
        return found;
    }
    async autoPopulatePda(accountDesc) {
        if (!accountDesc.pda || !accountDesc.pda.seeds)
            throw new Error("Must have seeds");
        const seeds = await Promise.all(accountDesc.pda.seeds.map((seedDesc) => this.toBuffer(seedDesc)));
        const programId = await this.parseProgramId(accountDesc);
        const [pubkey] = await PublicKey.findProgramAddress(seeds, programId);
        this._accounts[camelCase(accountDesc.name)] = pubkey;
    }
    async parseProgramId(accountDesc) {
        var _a;
        if (!((_a = accountDesc.pda) === null || _a === void 0 ? void 0 : _a.programId)) {
            return this._programId;
        }
        switch (accountDesc.pda.programId.kind) {
            case "const":
                return new PublicKey(this.toBufferConst(accountDesc.pda.programId.value));
            case "arg":
                return this.argValue(accountDesc.pda.programId);
            case "account":
                return await this.accountValue(accountDesc.pda.programId);
            default:
                throw new Error(`Unexpected program seed kind: ${accountDesc.pda.programId.kind}`);
        }
    }
    async toBuffer(seedDesc) {
        switch (seedDesc.kind) {
            case "const":
                return this.toBufferConst(seedDesc);
            case "arg":
                return await this.toBufferArg(seedDesc);
            case "account":
                return await this.toBufferAccount(seedDesc);
            default:
                throw new Error(`Unexpected seed kind: ${seedDesc.kind}`);
        }
    }
    toBufferConst(seedDesc) {
        return this.toBufferValue(seedDesc.type, seedDesc.value);
    }
    async toBufferArg(seedDesc) {
        const argValue = this.argValue(seedDesc);
        return this.toBufferValue(seedDesc.type, argValue);
    }
    argValue(seedDesc) {
        const seedArgName = camelCase(seedDesc.path.split(".")[0]);
        const idlArgPosition = this._idlIx.args.findIndex((argDesc) => argDesc.name === seedArgName);
        if (idlArgPosition === -1) {
            throw new Error(`Unable to find argument for seed: ${seedArgName}`);
        }
        return this._args[idlArgPosition];
    }
    async toBufferAccount(seedDesc) {
        const accountValue = await this.accountValue(seedDesc);
        return this.toBufferValue(seedDesc.type, accountValue);
    }
    async accountValue(seedDesc) {
        const pathComponents = seedDesc.path.split(".");
        const fieldName = pathComponents[0];
        const fieldPubkey = this._accounts[camelCase(fieldName)];
        // The seed is a pubkey of the account.
        if (pathComponents.length === 1) {
            return fieldPubkey;
        }
        // The key is account data.
        //
        // Fetch and deserialize it.
        const account = await this._accountStore.fetchAccount(fieldPubkey, seedDesc.account);
        // Dereference all fields in the path to get the field value
        // used in the seed.
        const fieldValue = this.parseAccountValue(account, pathComponents.slice(1));
        return fieldValue;
    }
    parseAccountValue(account, path) {
        let accountField;
        while (path.length > 0) {
            accountField = account[camelCase(path[0])];
            path = path.slice(1);
        }
        return accountField;
    }
    // Converts the given idl valaue into a Buffer. The values here must be
    // primitives. E.g. no structs.
    //
    // TODO: add more types here as needed.
    toBufferValue(type, value) {
        switch (type) {
            case "u8":
                return Buffer.from([value]);
            case "u16":
                let b = Buffer.alloc(2);
                b.writeUInt16LE(value);
                return b;
            case "u32":
                let buf = Buffer.alloc(4);
                buf.writeUInt32LE(value);
                return buf;
            case "u64":
                let bU64 = Buffer.alloc(8);
                bU64.writeBigUInt64LE(BigInt(value));
                return bU64;
            case "string":
                return Buffer.from(utf8.encode(value));
            case "publicKey":
                return value.toBuffer();
            default:
                if (type.array) {
                    return Buffer.from(value);
                }
                throw new Error(`Unexpected seed type: ${type}`);
        }
    }
}
AccountsResolver.CONST_ACCOUNTS = {
    associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
    rent: SYSVAR_RENT_PUBKEY,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
};
// TODO: this should be configureable to avoid unnecessary requests.
export class AccountStore {
    // todo: don't use the progrma use the account namespace.
    constructor(_provider, _accounts) {
        this._provider = _provider;
        this._accounts = _accounts;
        this._cache = new Map();
    }
    async fetchAccount(publicKey, name) {
        const address = publicKey.toString();
        if (!this._cache.has(address)) {
            if (name === "TokenAccount") {
                const accountInfo = await this._provider.connection.getAccountInfo(publicKey);
                if (accountInfo === null) {
                    throw new Error(`invalid account info for ${address}`);
                }
                const data = coder().accounts.decode("token", accountInfo.data);
                this._cache.set(address, data);
            }
            else if (name) {
                const account = this._accounts[camelCase(name)].fetch(publicKey);
                this._cache.set(address, account);
            }
            else {
                const account = await this._provider.connection.getAccountInfo(publicKey);
                if (account === null) {
                    throw new Error(`invalid account info for ${address}`);
                }
                const data = account.data;
                const firstAccountLayout = Object.values(this._accounts)[0];
                if (!firstAccountLayout) {
                    throw new Error("No accounts for this program");
                }
                const result = firstAccountLayout.coder.accounts.decodeAny(data);
                this._cache.set(address, result);
            }
        }
        return this._cache.get(address);
    }
}
//# sourceMappingURL=accounts-resolver.js.map