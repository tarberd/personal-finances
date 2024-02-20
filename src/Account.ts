export type Account = {
  name: string;
  info: AccountInfo;
  children: Account[];
};

export type AccountInfo = {
  kind: 'normalCredit' | 'normalDebit';
  statement: 'balanceSheet' | 'incomeStatement';
};

export type AccountTree = {
  rootAccounts: Account[];
};

export const isSubaccount = (parent: Account, child: Account): boolean => {
  return findAccount(parent, child.name) !== null;
};

export const preOrderTraversalReduce = <T>(
  account: Account,
  accumulate: T,
  f: (account: Account, accumulate: T) => T,
): T => {
  const accumulate2 = f(account, accumulate);
  return account.children.reduce(
    (acc, child) => preOrderTraversalReduce(child, acc, f),
    accumulate2,
  );
};

export const preOrderTraversalMap = <T>(
  account: Account,
  accumulate: T,
  pre_order: (account: Account, accumulate: T) => T,
  post_order: (account: Account, accumulate: T) => T,
): T => {
  const accumulate2 = pre_order(account, accumulate);
  account.children.flatMap((child) =>
    preOrderTraversalMap(child, accumulate2, pre_order, post_order),
  );
  return post_order(account, accumulate2);
};

export const findAccount = (account: Account, name: string): Account | null => {
  for (const child of account.children) {
    if (child.name === name) {
      return child;
    } else {
      const acc = findAccount(child, name);
      if (acc !== null) {
        return acc;
      }
    }
  }
  return null;
};

export const findAccountInAccountTree = (
  accountTree: AccountTree,
  name: string,
): Account | null => {
  for (const account of accountTree.rootAccounts) {
    if (account.name === name) {
      return account;
    } else {
      const acc = findAccount(account, name);
      if (acc !== null) {
        return acc;
      }
    }
  }
  return null;
};

export function addAccountTableEntryToAccount(account: Account, accountTableEntry: string[]) {
  if (accountTableEntry.length === 0) {
    return;
  }
  const newAccountName = accountTableEntry[0];
  const childAccount = account.children.find((acc) => acc.name === newAccountName);
  if (childAccount === undefined) {
    const newAccount = {
      name: newAccountName,
      info: account.info,
      children: [],
    };
    addAccountTableEntryToAccount(newAccount, accountTableEntry.slice(1));
    account.children.push(newAccount);
  } else {
    addAccountTableEntryToAccount(childAccount, accountTableEntry.slice(1));
  }
}

export function addAccountTableEntryToAccountTree(
  accountTree: AccountTree,
  accountTableEntry: string[],
) {
  if (accountTableEntry.length === 0) {
    return;
  }
  const account = accountTree.rootAccounts.find(
    (account) => account.name === accountTableEntry.at(0),
  );
  if (account === undefined) {
    return;
  }
  addAccountTableEntryToAccount(account, accountTableEntry.slice(1));
}
