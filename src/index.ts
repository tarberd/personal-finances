type Account = {
  name: string;
  children: Account[];
};

const newRootAcc = (name: string): Account => {
  return { name: name, children: [] };
};

const isSubaccount = (parent: Account, child: Account): boolean => {
  return findAccount(parent, child.name) !== null;
};

type RootAccountInfo = {
  kind: 'normalCredit' | 'normalDebit';
  statement: 'balanceSheet' | 'incomeStatement';
};

type AccountTree = {
  rootAccounts: [Account, RootAccountInfo][];
};

const nonEmptyCellFilter = (cell: string): boolean => cell !== '';
const nonEmptyRowFilter = (row: string[]): boolean => row[0] !== '';

const preOrderTraversal = (account: Account, f: (account: Account) => void) => {
  f(account);
  for (const child of account.children) {
    preOrderTraversal(child, f);
  }
};

const findAccount = (account: Account, name: string): Account | null => {
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

const findAccountInAccountTree = (accountTree: AccountTree, name: string): Account | null => {
  for (const [account] of accountTree.rootAccounts) {
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

function addAccountTableEntryToAccount(account: Account, accountTableEntry: string[]) {
  if (accountTableEntry.length === 0) {
    return;
  }
  const newAccountName = accountTableEntry[0];
  const entry = account.children.find((acc) => acc.name === newAccountName);
  if (entry === undefined) {
    const newAccount = newRootAcc(newAccountName);
    addAccountTableEntryToAccount(newAccount, accountTableEntry.slice(1));
    account.children.push(newAccount);
  } else {
    addAccountTableEntryToAccount(entry, accountTableEntry.slice(1));
  }
}

function addAccountTableEntryToAccountTree(accountTree: AccountTree, accountTableEntry: string[]) {
  const maybe = accountTree.rootAccounts.find(([acc]) => acc.name === accountTableEntry.at(0));
  if (maybe === undefined) {
    return;
  }
  const [account] = maybe;
  addAccountTableEntryToAccount(account, accountTableEntry.slice(1));
}

function makeAccountTree(accountTable: string[][], accountTypes: string[][]): AccountTree {
  const accountTree: AccountTree = {
    rootAccounts: [],
  };
  for (const [rootAccName, accountNormality, isPartOfNetRevenue] of accountTypes.filter(
    nonEmptyRowFilter,
  )) {
    const kind: 'normalCredit' | 'normalDebit' =
      accountNormality === 'Credit' ? 'normalCredit' : 'normalDebit';
    const statement: 'balanceSheet' | 'incomeStatement' =
      isPartOfNetRevenue === 'Yes' ? 'incomeStatement' : 'balanceSheet';
    accountTree.rootAccounts.push([newRootAcc(rootAccName), { kind: kind, statement: statement }]);
  }

  for (const accountTableEntry of accountTable.filter(nonEmptyRowFilter)) {
    addAccountTableEntryToAccountTree(accountTree, accountTableEntry.filter(nonEmptyCellFilter));
  }
  return accountTree;
}

type LedgerEntryData =
  | {
      kind: 'default';
      debitAccount: Account;
      creditAccount: Account;
      currency: string;
      value: number;
    }
  | {
      kind: 'liability';
      debitAccount: Account;
      creditAccount: Account;
      currency: string;
      value: number;
      paymentTerm: Date;
    }
  | {
      kind: 'exchange';
      debitAccount: Account;
      creditAccount: Account;
      exchangeAccount: Account;
      debitValue: number;
      debitCurrency: string;
      creditValue: number;
      creditCurrency: string;
    };

type LedgerEntry = {
  date: Date;
  description: string;
  data: LedgerEntryData;
};

type Ledger = {
  entries: LedgerEntry[];
};

type AccountEntry = {
  account: Account;
  type: 'debit' | 'credit';
  currency: string;
  value: number;
};

type MonthlyAccountingPeriod = {
  month: number;
  year: number;
};

function makeLedger(accountTree: AccountTree, ledgerTables: string[][][]): Ledger {
  const ledger: Ledger = {
    entries: [],
  };

  for (const ledgerTable of ledgerTables) {
    const ledgerTableEntries = ledgerTable.filter(nonEmptyRowFilter).values();
    const header = ledgerTableEntries.next();
    if (header.done === false) {
      const [, ledgerType, , currency] = header.value;
      ledgerTableEntries.next();
      if (ledgerType === 'General Ledger') {
        for (const entry of ledgerTableEntries) {
          const [date, description, debitAccountName, creditAccountName, value] = entry;
          const debitAccount = findAccountInAccountTree(accountTree, debitAccountName);
          const creditAccount = findAccountInAccountTree(accountTree, creditAccountName);
          if (debitAccount !== null && creditAccount !== null) {
            const ledgerEntry: LedgerEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: 'default',
                debitAccount,
                creditAccount,
                currency,
                value: +value,
              },
            };
            ledger.entries.push(ledgerEntry);
          }
        }
      } else if (ledgerType === 'Liability Ledger') {
        for (const entry of ledgerTableEntries) {
          const [date, description, debitAccountName, creditAccountName, value, term] = entry;
          const debitAccount = findAccountInAccountTree(accountTree, debitAccountName);
          const creditAccount = findAccountInAccountTree(accountTree, creditAccountName);
          if (debitAccount !== null && creditAccount !== null) {
            const ledgerEntry: LedgerEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: 'liability',
                debitAccount,
                creditAccount,
                currency,
                value: +value,
                paymentTerm: new Date(term),
              },
            };
            ledger.entries.push(ledgerEntry);
          }
        }
      } else if (ledgerType === 'Exchange Ledger') {
        for (const entry of ledgerTableEntries) {
          const [
            date,
            description,
            debitAccountName,
            creditAccountName,
            exchangeAccountName,
            debitCurrency,
            debitValue,
            creditCurrency,
            creditValue,
          ] = entry;
          const debitAccount = findAccountInAccountTree(accountTree, debitAccountName);
          const creditAccount = findAccountInAccountTree(accountTree, creditAccountName);
          const exchangeAccount = findAccountInAccountTree(accountTree, exchangeAccountName);
          if (debitAccount !== null && creditAccount !== null && exchangeAccount !== null) {
            const ledgerEntry: LedgerEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: 'exchange',
                debitAccount,
                creditAccount,
                exchangeAccount,
                debitCurrency,
                debitValue: +debitValue,
                creditCurrency,
                creditValue: +creditValue,
              },
            };
            ledger.entries.push(ledgerEntry);
          }
        }
      }
    }
  }
  ledger.entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  return ledger;
}

type SheetsReturnType = String | Date | number;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createMonthlyIncomeStatement(
  accountTypes: string[][],
  accountTable: string[][],
  currenciesTable: string[][],
  ...ledgerTables: string[][][]
): SheetsReturnType[][] {
  const currencies: string[] = [];
  for (const currencyEntry of currenciesTable.filter(nonEmptyRowFilter)) {
    currencies.push(currencyEntry[0]);
  }

  const ret: SheetsReturnType[][] = [];

  const accountTree = makeAccountTree(accountTable, accountTypes);

  const ledger = makeLedger(accountTree, ledgerTables);

  const ledgerByDate = ledger.entries.map((entry) => {
    const period = { month: entry.date.getMonth(), year: entry.date.getFullYear() };
    return { period, entry };
  });

  const ledgerByDateAndAccount = ledgerByDate.flatMap(({ period, entry }) => {
    const kind = entry.data.kind;
    if (kind === 'default' || kind === 'liability') {
      const creditEntry: AccountEntry = {
        account: entry.data.creditAccount,
        type: 'credit',
        currency: entry.data.currency,
        value: entry.data.value,
      };
      const debitEntry: AccountEntry = {
        account: entry.data.debitAccount,
        type: 'debit',
        currency: entry.data.currency,
        value: entry.data.value,
      };
      const credit = { period, originalEntry: entry, accountEntry: creditEntry };
      const debit = { period, originalEntry: entry, accountEntry: debitEntry };
      return [credit, debit];
    } else if (kind === 'exchange') {
      const creditEntry: AccountEntry = {
        account: entry.data.creditAccount,
        type: 'credit',
        currency: entry.data.creditCurrency,
        value: entry.data.creditValue,
      };
      const debitEntry: AccountEntry = {
        account: entry.data.debitAccount,
        type: 'debit',
        currency: entry.data.debitCurrency,
        value: entry.data.debitValue,
      };
      const exchangeDebitEntry: AccountEntry = {
        account: entry.data.exchangeAccount,
        type: 'debit',
        currency: entry.data.creditCurrency,
        value: entry.data.creditValue,
      };
      const exchangeCreditEntry: AccountEntry = {
        account: entry.data.exchangeAccount,
        type: 'credit',
        currency: entry.data.debitCurrency,
        value: entry.data.debitValue,
      };
      const credit = { period, originalEntry: entry, accountEntry: creditEntry };
      const debit = { period, originalEntry: entry, accountEntry: debitEntry };
      const exchangeCredit = {
        period,
        originalEntry: entry,
        accountEntry: exchangeCreditEntry,
      };
      const exchangeDebit = { period, originalEntry: entry, accountEntry: exchangeDebitEntry };
      return [credit, debit, exchangeCredit, exchangeDebit];
    }
    return [];
  });

  const beginDate = ledger.entries[0].date;
  const beginMonth = beginDate.getMonth();
  const beginYear = beginDate.getFullYear();
  const begin: [number, number] = [beginMonth, beginYear];
  const endDate = ledger.entries[ledger.entries.length - 1].date;
  const rollOver = endDate.getMonth() + 1 === 12;
  const endMonth = rollOver ? 0 : endDate.getMonth() + 1;
  const endYear = rollOver ? endDate.getFullYear() + 1 : endDate.getFullYear();
  const end: [number, number] = [endMonth, endYear];

  const months = [...generateAccountingPeriods(begin, end)].reverse();
  type x = {
    currency: string;
    period: MonthlyAccountingPeriod;
    account: Account;
    accountType: RootAccountInfo;
    entries: {
      period: {
        month: number;
        year: number;
      };
      originalEntry: LedgerEntry;
      accountEntry: AccountEntry;
    }[];
    total: number;
  };
  const transactionsByCurrencyAndAccount: x[] = [];

  for (const currency of currencies) {
    for (const [account, accountType] of accountTree.rootAccounts) {
      preOrderTraversal(account, (acc) => {
        for (const [month, year] of months) {
          const entries = ledgerByDateAndAccount.filter(({ period, accountEntry }) => {
            return (
              period.month === month &&
              period.year === year &&
              accountEntry.currency === currency &&
              (accountEntry.account === acc || isSubaccount(acc, accountEntry.account))
            );
          });
          let total = 0;
          for (const { accountEntry } of entries) {
            if (accountType.kind === 'normalCredit') {
              if (accountEntry.type === 'credit') {
                total += accountEntry.value;
              } else {
                total -= accountEntry.value;
              }
            } else {
              if (accountEntry.type === 'debit') {
                total += accountEntry.value;
              } else {
                total -= accountEntry.value;
              }
            }
          }
          transactionsByCurrencyAndAccount.push({
            currency,
            period: { month, year },
            account: acc,
            accountType,
            entries,
            total,
          });
        }
      });
    }
  }

  const monthsHeader: SheetsReturnType[] = [''];
  for (const [month, year] of months) {
    monthsHeader.push(new Date(year, month));
  }
  ret.push(monthsHeader);

  return ret;
}

function* generateAccountingPeriods(
  [beginMonth, beginYear]: [number, number],
  [endMonth, endYear]: [number, number],
): IterableIterator<[number, number]> {
  let year = beginYear;
  let month = beginMonth;
  while (true) {
    yield [month, year];
    month = month + 1;
    if (month % 12 === 0) {
      month = 0;
      year = year + 1;
    }
    if (year === endYear && month === endMonth) {
      break;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function collectAccountNames(accountList: string[], currentAcc: string | null, account: Account) {
  accountList.push((currentAcc === null ? '' : currentAcc) + account.name);
  const nextAccPrefix = currentAcc === null ? '\t\t' : currentAcc + '\t\t';
  for (const children of account.children) {
    collectAccountNames(accountList, nextAccPrefix, children);
  }
}
