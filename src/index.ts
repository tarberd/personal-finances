import { add, eachMonthOfInterval } from 'date-fns';
import {
  Account,
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
    end: ledger[ledger.length - 1].date,
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
  addAccountTableEntryToAccountTree(accountTree, ['equity', 'Retained Earnings']);
  const retainedEarningsAccount = findAccountInAccountTree(accountTree, 'Retained Earnings')!;
  const result = accountTree.rootAccounts.filter(
    ({ info }) => info.statement === 'incomeStatement',
  );
  retainedEarningsAccount.children.push(...result);
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
  const incomeStatementTable: SheetsReturnType[][] = [];
  const currencies = makeCurrencies(currenciesTable);
  const accountTree = makeAccountTree(accountTable, accountTypes);
  const rawEntries = parseLedgerTablesFromSheets(accountTree, ledgerTables);
  const entries = processRawEntries(rawEntries);

  const accountingPeriods = makeMonthlyAccountingPeriods(entries).reverse();

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
        if (account.info.statement !== 'balanceSheet') {
          return prefix;
        }
        const table_entry: SheetsReturnType[] = [];
        table_entry.push(prefix + account.name);
        const totals = byAccountAccumulated.find(({ account: toFind }) => toFind === account);
        if (totals === undefined) {
          incomeStatementTable.push(['error acount has no entry', account.name]);
        } else {
          for (const period of accountingPeriods) {
            for (const currency of currencies) {
              const { totalAccount, totalSubaccount } = totals.totals.get(period)!.get(currency)!;
              if (
                account.children.find((account) => account.info.statement === 'balanceSheet') !==
                undefined
              ) {
                table_entry.push(totalAccount);
              } else {
                table_entry.push(totalAccount + totalSubaccount);
              }
            }
          }
          incomeStatementTable.push(table_entry);
        }
        return prefix + '\t\t\t\t';
      },
      (account, prefix) => {
        if (account.info.statement !== 'balanceSheet') {
          return prefix;
        }
        if (
          account.children.find((account) => account.info.statement === 'balanceSheet') !==
          undefined
        ) {
          const table_entry: SheetsReturnType[] = [];
          table_entry.push(prefix.replace('\t\t\t\t', '') + 'TOTAL: ' + account.name);
          const totals = byAccountAccumulated.find(({ account: toFind }) => toFind === account);
          if (totals === undefined) {
            incomeStatementTable.push(['error aacount has no entry', account.name]);
          } else {
            for (const period of accountingPeriods) {
              for (const currency of currencies) {
                const { totalAccount, totalSubaccount } = totals.totals.get(period)!.get(currency)!;
                table_entry.push(totalAccount + totalSubaccount);
              }
            }
            incomeStatementTable.push(table_entry);
          }
        }
        return prefix.replace('\t\t\t\t', '');
      },
    );
  }
  return incomeStatementTable;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createMonthlyBudgetTable(
  accountTypes: SheetsTable,
  accountTable: SheetsTable,
): SheetsReturnType[][] {
  const accountTree = makeAccountTree(accountTable, accountTypes);
  const liabilitiesAccounts = accountTree.rootAccounts.filter(
    (account) => account.name === 'liabilities',
  );
  const expensesAccounts = accountTree.rootAccounts.filter(
    (account) => account.name === 'expenses',
  );
  const budgetTable: SheetsReturnType[][] = [];
  for (const account of liabilitiesAccounts.concat(expensesAccounts)) {
    preOrderTraversalMap<string>(
      account,
      '',
      (account, prefix) => {
        budgetTable.push([prefix + account.name]);
        return prefix + '\t\t\t\t';
      },
      (account, prefix) => {
        return prefix.replace('\t\t\t\t', '');
      },
    );
  }
  return budgetTable;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createMonthlyBudgetReviewTable(
  accountTypes: SheetsTable,
  accountTable: SheetsTable,
  currenciesTable: SheetsTable,
  budgetTable: SheetsTable,
  ...ledgerTables: SheetsTable[]
): SheetsReturnType[][] {
  const currencies = makeCurrencies(currenciesTable);
  const accountTree = makeAccountTree(accountTable, accountTypes);
  const rawEntries = parseLedgerTablesFromSheets(accountTree, ledgerTables);
  const entries = processRawEntries(rawEntries);

  const budgetPeriods: Period[] = [];
  const budgetTableValues = budgetTable.filter(nonEmptyRowFilter).values();
  const budgetMonthsHeader = budgetTableValues.next();
  if (budgetMonthsHeader.done === false) {
    const monthsInHeader = budgetMonthsHeader.value.filter(nonEmptyCellFilter).values();
    monthsInHeader.next();
    for (const month of monthsInHeader) {
      const begin = new Date(month);
      budgetPeriods.push({ begin, end: add(begin, { months: 1 }) });
    }
  }

  const budgetByAccount: Map<Account, Map<Period, number>> = new Map();
  for (const entry of budgetTableValues) {
    const values = entry.values();
    const dirtyAccountName = values.next();
    if (dirtyAccountName.done === false) {
      const account = findAccountInAccountTree(accountTree, dirtyAccountName.value.trimStart());
      if (account !== null) {
        const budgetByPeriod: Map<Period, number> = new Map();
        for (const period of budgetPeriods) {
          const value = values.next();
          let budget_value = 0;
          if (value.done === false) {
            budget_value = +value.value;
          }
          budgetByPeriod.set(period, budget_value);
        }
        budgetByAccount.set(account, budgetByPeriod);
      }
    }
  }

  const liabilitiesAccounts = accountTree.rootAccounts.filter(
    (account) => account.name === 'liabilities',
  );
  const expensesAccounts = accountTree.rootAccounts.filter(
    (account) => account.name === 'expenses',
  );

  type LiabilityTotals = {
    totalBorowed: number;
    totalPayed: number;
  };

  const totalByAccountOnTerm = liabilitiesAccounts.concat(expensesAccounts).reduce(
    (list, account) =>
      AccountTraversalReduce(
        account,
        list,
        (account, list) => {
          const byPeriod: Map<Period, Map<Currency, LiabilityTotals>> = new Map();
          for (const period of budgetPeriods) {
            const byCurrency: Map<Currency, LiabilityTotals> = new Map();
            for (const currency of currencies) {
              const creditEntries = entries.filter((entry) =>
                entry.term !== undefined
                  ? entry.account === account &&
                    entry.type === 'credit' &&
                    isDateWithinPeriod(entry.term, period) &&
                    entry.currency === currency
                  : false,
              );
              const debitEntries = entries.filter((entry) =>
                entry.term !== undefined
                  ? entry.account === account &&
                    entry.type === 'debit' &&
                    isDateWithinPeriod(entry.term, period) &&
                    entry.currency === currency
                  : false,
              );
              const reduceEntriesTotal = (total: number, entry: Entry): number => {
                if (account.info.kind === 'normalCredit') {
                  if (entry.type === 'credit') {
                    return total + entry.value;
                  } else {
                    return total - entry.value;
                  }
                } else {
                  if (entry.type === 'credit') {
                    return total + entry.value;
                  } else {
                    return total - entry.value;
                  }
                }
              };
              const total_credit = creditEntries.reduce(reduceEntriesTotal, 0);
              const total_debit = debitEntries.reduce(reduceEntriesTotal, 0);
              byCurrency.set(currency, { totalBorowed: total_credit, totalPayed: total_debit });
            }
            byPeriod.set(period, byCurrency);
          }
          return [...list, { account, totals: byPeriod }];
        },
        (account, acc) => {
          return acc;
        },
      ),
    [] as { account: Account; totals: Map<Period, Map<Currency, LiabilityTotals>> }[],
  );

  const totalByAccount = liabilitiesAccounts.concat(expensesAccounts).reduce(
    (list, account) =>
      AccountTraversalReduce(
        account,
        list,
        (account, list) => {
          const byPeriod: Map<Period, Map<Currency, LiabilityTotals>> = new Map();
          for (const period of budgetPeriods) {
            const byCurrency: Map<Currency, LiabilityTotals> = new Map();
            for (const currency of currencies) {
              const creditEntries = entries.filter((entry) =>
                entry.term === undefined
                  ? entry.account === account &&
                    entry.type === 'credit' &&
                    isDateWithinPeriod(entry.date, period) &&
                    entry.currency === currency
                  : false,
              );
              const debitEntries = entries.filter((entry) =>
                entry.term === undefined
                  ? entry.account === account &&
                    entry.type === 'debit' &&
                    isDateWithinPeriod(entry.date, period) &&
                    entry.currency === currency
                  : false,
              );
              const reduceEntriesTotal = (total: number, entry: Entry): number => {
                if (account.info.kind === 'normalCredit') {
                  if (entry.type === 'credit') {
                    return total + entry.value;
                  } else {
                    return total - entry.value;
                  }
                } else {
                  if (entry.type === 'credit') {
                    return total + entry.value;
                  } else {
                    return total - entry.value;
                  }
                }
              };
              const total_credit = creditEntries.reduce(reduceEntriesTotal, 0);
              const total_debit = debitEntries.reduce(reduceEntriesTotal, 0);
              byCurrency.set(currency, { totalBorowed: total_credit, totalPayed: total_debit });
            }
            byPeriod.set(period, byCurrency);
          }
          return [...list, { account, totals: byPeriod }];
        },
        (account, acc) => {
          return acc;
        },
      ),
    [] as { account: Account; totals: Map<Period, Map<Currency, LiabilityTotals>> }[],
  );

  const ret: SheetsReturnType[][] = [];

  const header1: SheetsReturnType[] = ['Ready to Assign'];
  const readyToAssign = 0;
  const header2: SheetsReturnType[] = [readyToAssign];
  for (const period of budgetPeriods) {
    header1.push(period.begin, period.begin, period.begin, period.begin, period.begin);
    header2.push('Budgeted', 'Borrowed', 'Target', 'Activity', 'Available');
  }
  ret.push(header1, header2);
  for (const account of liabilitiesAccounts) {
    preOrderTraversalMap<string>(
      account,
      '',
      (account, prefix) => {
        const tableEntry: SheetsReturnType[] = [prefix + account.name];
        const budgetByPeriod = budgetByAccount.get(account);
        const executedByPeriod = totalByAccountOnTerm.find(
          ({ account: toFind }) => account === toFind,
        );
        if (budgetByPeriod !== undefined && executedByPeriod !== undefined) {
          for (const period of budgetPeriods) {
            const value = budgetByPeriod.get(period);
            if (value !== undefined) {
              const target = executedByPeriod.totals.get(period)!.get('BRL')!.totalBorowed;
              const activity = -executedByPeriod.totals.get(period)!.get('BRL')!.totalPayed;
              const borrowed = 0;
              tableEntry.push(value, borrowed, target, activity, value + borrowed - activity);
            } else {
              tableEntry.push('period undefined');
            }
          }
        } else {
          tableEntry.push('account undefined');
        }
        ret.push(tableEntry);
        return prefix + '\t\t\t\t';
      },
      (account, prefix) => {
        return prefix.replace('\t\t\t\t', '');
      },
    );
  }
  for (const account of expensesAccounts) {
    preOrderTraversalMap<string>(
      account,
      '',
      (account, prefix) => {
        const tableEntry: SheetsReturnType[] = [prefix + account.name];
        const budgetByPeriod = budgetByAccount.get(account);
        const executedByPeriodOnTerm = totalByAccountOnTerm.find(
          ({ account: toFind }) => account === toFind,
        );
        const executedByPeriod = totalByAccount.find(({ account: toFind }) => account === toFind);
        if (
          budgetByPeriod !== undefined &&
          executedByPeriodOnTerm !== undefined &&
          executedByPeriod !== undefined
        ) {
          for (const period of budgetPeriods) {
            const value = budgetByPeriod.get(period);
            if (value !== undefined) {
              const borrowed = executedByPeriodOnTerm.totals.get(period)!.get('EUR')!.totalBorowed;
              const target = 0;
              const activity =
                borrowed + executedByPeriod.totals.get(period)!.get('EUR')!.totalPayed;
              tableEntry.push(value, borrowed, target, activity, value + borrowed - activity);
            } else {
              tableEntry.push('period undefined');
            }
          }
        } else {
          tableEntry.push('account undefined');
        }
        ret.push(tableEntry);
        return prefix + '\t\t\t\t';
      },
      (account, prefix) => {
        return prefix.replace('\t\t\t\t', '');
      },
    );
  }
  return ret;
}
