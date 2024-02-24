import { add, eachMonthOfInterval } from 'date-fns';
import {
  Account,
  AccountInfo,
  AccountTree,
  addAccountTableEntryToAccountTree,
  findAccountInAccountTree,
  AccountTraversalRecuce as AccountTraversalReduce,
  isSubaccount,
  preOrderTraversalMap,
} from './Account';
import { RawEntry, Entry, processRawEntries } from './Entry';
import { Currency } from './Currency';

const nonEmptyCellFilter = (cell: string): boolean => cell !== '';
const nonEmptyRowFilter = (row: string[]): boolean => row[0] !== '';

type Period = {
  begin: Date;
  end: Date;
};

const isDateWithinPeriod = (date: Date, period: Period): boolean =>
  date >= period.begin && date < period.end;

const isDateLessThanPeriod = (date: Date, period: Period): boolean => date < period.end;

const makeMonthlyAccountingPeriods = (ledger: Entry[]): Period[] =>
  eachMonthOfInterval({
    start: ledger[0].date,
    end: add(ledger[ledger.length - 1].date, { months: 1 }),
  }).map((firstDate) => ({
    begin: firstDate,
    end: add(firstDate, { months: 1 }),
  }));

const makeCurrencies = (currenciesTable: string[][]): Currency[] =>
  currenciesTable.filter(nonEmptyRowFilter).map((row) => row[0]);

function makeAccountTree(accountTable: SheetsTable, accountTypes: SheetsTable): AccountTree {
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
    accountTree.rootAccounts.push({
      name: rootAccName,
      info: { kind: kind, statement: statement },
      children: [],
    });
  }
  for (const accountTableEntry of accountTable.filter(nonEmptyRowFilter)) {
    addAccountTableEntryToAccountTree(accountTree, accountTableEntry.filter(nonEmptyCellFilter));
  }
  return accountTree;
}

function parseLedgerTablesFromSheets(
  accountTree: AccountTree,
  ledgerTables: string[][][],
): RawEntry[] {
  const ledger: RawEntry[] = [];
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
            const ledgerEntry: RawEntry = {
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
            ledger.push(ledgerEntry);
          }
        }
      } else if (ledgerType === 'Liability Ledger') {
        for (const entry of ledgerTableEntries) {
          const [date, description, debitAccountName, creditAccountName, value, term] = entry;
          const debitAccount = findAccountInAccountTree(accountTree, debitAccountName);
          const creditAccount = findAccountInAccountTree(accountTree, creditAccountName);
          if (debitAccount !== null && creditAccount !== null) {
            const ledgerEntry: RawEntry = {
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
            ledger.push(ledgerEntry);
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
            const ledgerEntry: RawEntry = {
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
            ledger.push(ledgerEntry);
          }
        }
      }
    }
  }
  ledger.sort((a, b) => (a.date < b.date ? -1 : 1));
  return ledger;
}
type AccountTotalByCurrency = Map<Currency, { totalAccount: number; totalSubaccount: number }>;
type AccountTotalByPeriod = Map<Period, AccountTotalByCurrency>;
type AccountTotals = {
  account: Account;
  totals: AccountTotalByPeriod;
};
function accountTotalsByPeriodAndCurrency(
  accounts: Account[],
  accountingPeriods: Period[],
  currencies: Currency[],
  entries: Entry[],
): AccountTotals[] {
  return accounts.reduce(
    (list, account) =>
      AccountTraversalReduce(
        account,
        list,
        (account, list) => {
          const byPeriod: AccountTotalByPeriod = new Map();
          for (const period of accountingPeriods) {
            const byCurrency: AccountTotalByCurrency = new Map();
            for (const currency of currencies) {
              const entriesOnPeriodAndCurrency = entries.filter(
                (entry) =>
                  entry.account === account &&
                  isDateWithinPeriod(entry.date, period) &&
                  entry.currency === currency,
              );
              const subaccountEntriesOnPeriodAndCurrency = entries.filter(
                (entry) =>
                  isSubaccount(account, entry.account) &&
                  isDateWithinPeriod(entry.date, period) &&
                  entry.currency === currency,
              );
              const reduceEntriesTotal = (total: number, entry: Entry) => {
                if (account.info.kind === 'normalCredit') {
                  if (entry.type === 'credit') {
                    return total + entry.value;
                  } else {
                    return total - entry.value;
                  }
                } else {
                  if (entry.type === 'debit') {
                    return total + entry.value;
                  } else {
                    return total - entry.value;
                  }
                }
              };
              const totalAccount = entriesOnPeriodAndCurrency.reduce(reduceEntriesTotal, 0);
              const totalSubaccount = subaccountEntriesOnPeriodAndCurrency.reduce(
                reduceEntriesTotal,
                0,
              );
              byCurrency.set(currency, { totalAccount, totalSubaccount });
            }
            byPeriod.set(period, byCurrency);
          }
          return [...list, { account, totals: byPeriod }];
        },
        (account, acc) => {
          return acc;
        },
      ),
    [] as AccountTotals[],
  );
}

type SheetsReturnType = String | Date | number;
type SheetsTable = string[][];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createMonthlyIncomeStatement(
  accountTypes: SheetsTable,
  accountTable: SheetsTable,
  currenciesTable: SheetsTable,
  ...ledgerTables: SheetsTable[]
): SheetsReturnType[][] {
  const currencies = makeCurrencies(currenciesTable);
  const accountTree = makeAccountTree(accountTable, accountTypes);
  const rawEntries = parseLedgerTablesFromSheets(accountTree, ledgerTables);
  const entries = processRawEntries(rawEntries);

  const accountingPeriods = makeMonthlyAccountingPeriods(entries).reverse();

  const revenue_account = findAccountInAccountTree(accountTree, 'revenue')!;
  const exchange_account = findAccountInAccountTree(accountTree, 'exchange')!;
  const expenses_account = findAccountInAccountTree(accountTree, 'expenses')!;
  const incomeStatementAccounts = [revenue_account, exchange_account, expenses_account];

  const byAccount = accountTotalsByPeriodAndCurrency(
    incomeStatementAccounts,
    accountingPeriods,
    currencies,
    entries,
  );

  const incomeStatementTable: SheetsReturnType[][] = [];
  const currenciesHeader: SheetsReturnType[] = [''];
  const periodsHeader: SheetsReturnType[] = [''];
  for (const { begin } of accountingPeriods) {
    for (const currency of currencies) {
      currenciesHeader.push(currency);
      periodsHeader.push(begin);
    }
  }
  const netIncomeHeader: number[][] = [[], [], [], []];
  for (const [index, account] of incomeStatementAccounts.entries()) {
    const totals = byAccount.find(({ account: toFind }) => account === toFind)!.totals;
    for (const period of accountingPeriods) {
      for (const currency of currencies) {
        const { totalAccount, totalSubaccount } = totals.get(period)!.get(currency)!;
        netIncomeHeader[index].push(totalAccount + totalSubaccount);
      }
    }
  }
  for (const [index] of netIncomeHeader[0].entries()) {
    netIncomeHeader[3].push(
      (netIncomeHeader[0][index] as number) +
        (netIncomeHeader[1][index] as number) -
        (netIncomeHeader[2][index] as number),
    );
  }
  incomeStatementTable.push(currenciesHeader);
  incomeStatementTable.push(periodsHeader);
  incomeStatementTable.push(['Total Revenue', ...netIncomeHeader[0]]);
  incomeStatementTable.push(['Total Exchange', ...netIncomeHeader[1]]);
  incomeStatementTable.push(['Total Expenses', ...netIncomeHeader[2]]);
  incomeStatementTable.push(['Net Revenue', ...netIncomeHeader[3]]);
  for (const account of incomeStatementAccounts) {
    preOrderTraversalMap<string>(
      account,
      '',
      (account, prefix) => {
        const table_entry: SheetsReturnType[] = [];
        table_entry.push(prefix + account.name);
        const totals = byAccount.find(({ account: toFind }) => toFind === account)!.totals;
        for (const period of accountingPeriods) {
          for (const currency of currencies) {
            table_entry.push(totals.get(period)!.get(currency)!.totalAccount);
          }
        }
        incomeStatementTable.push(table_entry);
        return prefix + '\t\t\t\t';
      },
      (account, prefix) => {
        if (account.children.length !== 0) {
          const table_entry: SheetsReturnType[] = [];
          table_entry.push(prefix.replace('\t\t\t\t', '') + 'TOTAL: ' + account.name);
          const totals = byAccount.find(({ account: toFind }) => toFind === account)!.totals;
          for (const period of accountingPeriods) {
            for (const currency of currencies) {
              const { totalAccount, totalSubaccount } = totals.get(period)!.get(currency)!;
              table_entry.push(totalAccount + totalSubaccount);
            }
          }
          incomeStatementTable.push(table_entry);
        }
        return prefix.replace('\t\t\t\t', '');
      },
    );
  }
  return incomeStatementTable;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createMonthlyBalanceSheet(
  accountTypes: SheetsTable,
  accountTable: SheetsTable,
  currenciesTable: SheetsTable,
  ...ledgerTables: SheetsTable[]
): SheetsReturnType[][] {
  const currencies = makeCurrencies(currenciesTable);
  const accountTree = makeAccountTree(accountTable, accountTypes);
  const rawEntries = parseLedgerTablesFromSheets(accountTree, ledgerTables);
  const entries = processRawEntries(rawEntries);

  const accountingPeriods = makeMonthlyAccountingPeriods(entries).reverse();

  const equity = findAccountInAccountTree(accountTree, 'equity')!;
  equity.children.push(
    {
      name: 'Retained Earnings',
      info: {
        kind: 'normalCredit',
        statement: 'balanceSheet',
      },
      children: [],
    },
    {
      name: 'Net Revenue',
      info: {
        kind: 'normalCredit',
        statement: 'balanceSheet',
      },
      children: [],
    },
  );
  const netRevenueAccount = findAccountInAccountTree(accountTree, 'Net Revenue')!;

  const incomeStatementAccounts = accountTree.rootAccounts.filter(
    (account) => account.info.statement === 'incomeStatement',
  );

  const byAccount = accountTotalsByPeriodAndCurrency(
    incomeStatementAccounts,
    accountingPeriods,
    currencies,
    entries,
  );

  const revenue_account = findAccountInAccountTree(accountTree, 'revenue')!;
  const exchange_account = findAccountInAccountTree(accountTree, 'exchange')!;
  const expenses_account = findAccountInAccountTree(accountTree, 'expenses')!;
  const totalsRevenue = byAccount.find(({ account: toFind }) => revenue_account === toFind)!.totals;
  const totalsExchange = byAccount.find(
    ({ account: toFind }) => exchange_account === toFind,
  )!.totals;
  const totalsExpenses = byAccount.find(
    ({ account: toFind }) => expenses_account === toFind,
  )!.totals;
  const netRevenue: AccountTotalByPeriod = new Map();
  for (const period of accountingPeriods) {
    const byCurrency: AccountTotalByCurrency = new Map();
    for (const currency of currencies) {
      const { totalAccount: revenue1, totalSubaccount: revenue2 } = totalsRevenue
        .get(period)!
        .get(currency)!;
      const { totalAccount: expenses1, totalSubaccount: expenses2 } = totalsExpenses
        .get(period)!
        .get(currency)!;
      const { totalAccount: exchange1, totalSubaccount: exchange2 } = totalsExchange
        .get(period)!
        .get(currency)!;
      const totalAccount = revenue1 + exchange1 - expenses1;
      const totalSubaccount = revenue2 + exchange2 - expenses2;
      byCurrency.set(currency, { totalAccount, totalSubaccount });
    }
    netRevenue.set(period, byCurrency);
  }

  const balanceSheetAccounts = accountTree.rootAccounts.filter(
    (account) => account.info.statement === 'balanceSheet',
  );

  const byAccountAccumulated = balanceSheetAccounts.reduce(
    (list, account) =>
      AccountTraversalReduce(
        account,
        list,
        (account, list) => {
          const byPeriod: AccountTotalByPeriod = new Map();
          for (const period of accountingPeriods) {
            const byCurrency: AccountTotalByCurrency = new Map();
            for (const currency of currencies) {
              const entriesOnPeriodAndCurrency = entries.filter(
                (entry) =>
                  entry.account === account &&
                  isDateLessThanPeriod(entry.date, period) &&
                  entry.currency === currency,
              );
              const subaccountEntriesOnPeriodAndCurrency = entries.filter(
                (entry) =>
                  isSubaccount(account, entry.account) &&
                  isDateLessThanPeriod(entry.date, period) &&
                  entry.currency === currency,
              );
              const reduceEntriesTotal = (total: number, entry: Entry) => {
                if (account.info.kind === 'normalCredit') {
                  if (entry.type === 'credit') {
                    return total + entry.value;
                  } else {
                    return total - entry.value;
                  }
                } else {
                  if (entry.type === 'debit') {
                    return total + entry.value;
                  } else {
                    return total - entry.value;
                  }
                }
              };
              const totalAccount = entriesOnPeriodAndCurrency.reduce(reduceEntriesTotal, 0);
              const totalSubaccount = subaccountEntriesOnPeriodAndCurrency.reduce(
                reduceEntriesTotal,
                0,
              );
              byCurrency.set(currency, { totalAccount, totalSubaccount });
            }
            byPeriod.set(period, byCurrency);
          }
          return [...list, { account, totals: byPeriod }];
        },
        (account, acc) => {
          return acc;
        },
      ),
    [] as AccountTotals[],
  );

  byAccountAccumulated.push({
    account: netRevenueAccount,
    totals: netRevenue,
  });

  const incomeStatementTable: SheetsReturnType[][] = [];
  const currenciesHeader: SheetsReturnType[] = [''];
  const periodsHeader: SheetsReturnType[] = [''];
  for (const { begin } of accountingPeriods) {
    for (const currency of currencies) {
      currenciesHeader.push(currency);
      periodsHeader.push(begin);
    }
  }
  // const netIncomeHeader: number[][] = [[], [], [], []];
  // for (const [index, account] of incomeStatementAccounts.entries()) {
  //   const totals = byAccount.find(({ account: toFind }) => account === toFind)!.totals;
  //   for (const period of accountingPeriods) {
  //     for (const currency of currencies) {
  //       const { totalAccount, totalSubaccount } = totals.get(period)!.get(currency)!;
  //       netIncomeHeader[index].push(totalAccount + totalSubaccount);
  //     }
  //   }
  // }
  // for (const [index] of netIncomeHeader[0].entries()) {
  //   netIncomeHeader[3].push(
  //     (netIncomeHeader[0][index] as number) +
  //       (netIncomeHeader[1][index] as number) -
  //       (netIncomeHeader[2][index] as number),
  //   );
  // }
  incomeStatementTable.push(currenciesHeader);
  incomeStatementTable.push(periodsHeader);
  // incomeStatementTable.push(['Total Revenue', ...netIncomeHeader[0]]);
  // incomeStatementTable.push(['Total Exchange', ...netIncomeHeader[1]]);
  // incomeStatementTable.push(['Total Expenses', ...netIncomeHeader[2]]);
  // incomeStatementTable.push(['Net Revenue', ...netIncomeHeader[3]]);
  for (const account of balanceSheetAccounts) {
    preOrderTraversalMap<string>(
      account,
      '',
      (account, prefix) => {
        const table_entry: SheetsReturnType[] = [];
        table_entry.push(prefix + account.name);
        const totals = byAccountAccumulated.find(
          ({ account: toFind }) => toFind === account,
        )!.totals;
        for (const period of accountingPeriods) {
          for (const currency of currencies) {
            table_entry.push(totals.get(period)!.get(currency)!.totalAccount);
          }
        }
        incomeStatementTable.push(table_entry);
        return prefix + '\t\t\t\t';
      },
      (account, prefix) => {
        if (account.children.length !== 0) {
          const table_entry: SheetsReturnType[] = [];
          table_entry.push(prefix.replace('\t\t\t\t', '') + 'TOTAL: ' + account.name);
          const totals = byAccountAccumulated.find(
            ({ account: toFind }) => toFind === account,
          )!.totals;
          for (const period of accountingPeriods) {
            for (const currency of currencies) {
              const { totalAccount, totalSubaccount } = totals.get(period)!.get(currency)!;
              table_entry.push(totalAccount + totalSubaccount);
            }
          }
          incomeStatementTable.push(table_entry);
        }
        return prefix.replace('\t\t\t\t', '');
      },
    );
  }
  incomeStatementTable.push(['test']);
  return incomeStatementTable;
}
