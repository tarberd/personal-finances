type Account = {
  name: string,
  children: Account[],
}

const new_root_acc = (name: string): Account => {
  return {name: name, children: []};
}

type RootAccountInfo = {
  kind: "normal_credit" | "normal_debit",
  statement: "balance_sheet" | "income_statement",
}

type AccountTree = {
  root_accounts: [Account, RootAccountInfo][], 
}

const non_empty_cell_filter = (cell: string): boolean => cell !== "";
const non_empty_row_filter = (row: string[]): boolean => row[0] !== "";

const pre_order_traversal = (account: Account, f: (account: Account) => any) => {
  f(account);
  for (const child of account.children) {
    pre_order_traversal(child, f);
  }
}

const find_account = (account: Account, name: string): Account | null => {
  for (const child of account.children) {
    if (child.name === name) {
      return child;
    } else {
      const acc = find_account(child, name)
      if (acc !== null) {
        return acc;
      }
    }
  }
  return null;
}

const find_account_in_account_tree = (account_tree: AccountTree, name: string): Account | null => {
  for (const [account, ] of account_tree.root_accounts) {
    if (account.name === name) {
      return account;
    } else {
      const acc = find_account(account, name)
      if (acc !== null) {
        return acc;
      }
    }
  }
  return null;
}

function add_account_table_entry_to_account(account: Account, account_table_entry: string[]) {
  if (account_table_entry.length === 0) {
    return;
  }
  let new_account_name = account_table_entry[0]
  let entry = account.children.find((acc) => acc.name === new_account_name);
  if (entry === undefined) {
    let new_account = new_root_acc(new_account_name);
    add_account_table_entry_to_account(new_account, account_table_entry.slice(1));
    account.children.push(new_account);
  } else {
    add_account_table_entry_to_account(entry, account_table_entry.slice(1));
  }
}

function add_account_table_entry_to_account_tree(account_tree: AccountTree, account_table_entry: string[]){
  const maybe = account_tree.root_accounts.find(([acc, ]) => acc.name === account_table_entry.at(0));
  if (maybe === undefined) {
    return;
  }
  let [account, ] = maybe;
  add_account_table_entry_to_account(account, account_table_entry.slice(1));
}

function make_account_tree(account_table: string[][], account_types: string[][]): AccountTree {
  let account_tree: AccountTree = {
    root_accounts: []
  };
  for (const [root_acc_name, account_normality, is_part_of_net_revenue] of account_types.filter(non_empty_row_filter)) {
    let kind: "normal_credit" | "normal_debit" = account_normality === "Credit" ? "normal_credit" : "normal_debit";
    let statement: "balance_sheet" | "income_statement" = is_part_of_net_revenue === "Yes" ? "income_statement" : "balance_sheet";
    account_tree.root_accounts.push([new_root_acc(root_acc_name), {kind: kind, statement: statement}]);
  }

  for (const account_table_entry of account_table.filter(non_empty_row_filter)) {
    add_account_table_entry_to_account_tree(account_tree, account_table_entry.filter(non_empty_cell_filter))
  }
  return account_tree;
}

type LedgerEntryData = {
  kind: "default",
  debit_account: Account,
  credit_account: Account,
  currency: string,
  value: number,
} | 
{
  kind: "liability",
  debit_account: Account,
  credit_account: Account,
  currency: string,
  value: number,
  payment_term: Date,
} |
{
  kind: "exchange",
  debit_account: Account,
  credit_account: Account,
  exchange_account: Account,
  debit_value: number,
  debit_currency: string,
  credit_value: number,
  credit_currency: string,
}

type LedgerEntry = {
  date: Date,
  description: string,
  data: LedgerEntryData,
}

type Ledger = {
  entries: LedgerEntry[],
}

type AccountEntry = {
  date: Date,
  description: string,
  type: "debit" | "credit",
  value: number,
}

function make_ledger(account_tree: AccountTree, ledger_tables: string[][][]): Ledger {
  const ledger = {
    entries: new Array<LedgerEntry>,
  };

  for (const ledger_table of ledger_tables) {
    const ledger_table_entries = ledger_table.filter(non_empty_row_filter).values();
    const header = ledger_table_entries.next();
    if (header.done === false) {
      const [, ledger_type, , currency] = header.value;
      ledger_table_entries.next();
      if (ledger_type === "General Ledger") {
        for (const entry of ledger_table_entries){
          const [date, description, debit_account_name, credit_account_name, value] = entry;
          const debit_account = find_account_in_account_tree(account_tree, debit_account_name);
          const credit_account = find_account_in_account_tree(account_tree, credit_account_name);
          if (debit_account !== null && credit_account !== null ) {
            const ledger_entry: LedgerEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: "default",
                debit_account,
                credit_account,
                currency,
                value: +value,
              },
            };
            ledger.entries.push(ledger_entry);
          }
        }
      } else if (ledger_type === "Liability Ledger") {
        for (const entry of ledger_table_entries){
          const [date, description, debit_account_name, credit_account_name, value, term] = entry;
          const debit_account = find_account_in_account_tree(account_tree, debit_account_name);
          const credit_account = find_account_in_account_tree(account_tree, credit_account_name);
          if (debit_account !== null && credit_account !== null ) {
            const ledger_entry: LedgerEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: "liability",
                debit_account,
                credit_account,
                currency,
                value: +value,
                payment_term: new Date(term),
              },
            };
            ledger.entries.push(ledger_entry);
          }
        }
      } else if (ledger_type === "Exchange Ledger") {
        for (const entry of ledger_table_entries){
          const [
            date,
            description,
            debit_account_name,
            credit_account_name,
            exchange_account_name,
            debit_currency,
            debit_value,
            credit_currency,
            credit_value,
          ] = entry;
          const debit_account = find_account_in_account_tree(account_tree, debit_account_name);
          const credit_account = find_account_in_account_tree(account_tree, credit_account_name);
          const exchange_account = find_account_in_account_tree(account_tree, exchange_account_name);
          if (debit_account !== null && credit_account !== null && exchange_account !== null) {
            const ledger_entry: LedgerEntry = {
              date: new Date(date),
              description: description,
              data: {
                kind: "exchange",
                debit_account,
                credit_account,
                exchange_account,
                debit_currency,
                debit_value: +debit_value,
                credit_currency,
                credit_value: +credit_value,
              },
            };
            ledger.entries.push(ledger_entry);
          }
        }
      }
    }
  }
  ledger.entries.sort((a, b) => a.date < b.date ? -1 : 1);
  return ledger;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function create_monthly_income_statement(
  account_types: string[][],
  account_table: string[][],
  currencies_table: string[][],
  ...ledger_tables: string[][][]
): any[][] {
  const currencies = new Array<string>;
  for (const currency_entry of currencies_table.filter(non_empty_row_filter)) {
    currencies.push(currency_entry[0]);
  }

  const ret: string[][] = [];
  
  const account_tree = make_account_tree(account_table, account_types);
  // for (const [account, info] of account_tree.root_accounts) {
  //   let account_list: string[] = [];
  //   collect_account_names(account_list, null, account);
  //   for (const name of account_list) {
  //     ret.push([name, info.kind, info.statement]);
  //   }
  // }
  
  const ledger = make_ledger(account_tree, ledger_tables);
  // for (const entry of ledger.entries) {
  //   if (entry.data.kind === "default") {
  //     ret.push([entry.date.toDateString(), entry.description, entry.data.credit_account.name, entry.data.debit_account.name, entry.data.currency, entry.data.value.toString() ]);
  //   }
  //   if (entry.data.kind === "liability") {
  //     ret.push([entry.date.toDateString(), entry.description, entry.data.credit_account.name, entry.data.debit_account.name, entry.data.currency, entry.data.value.toString(), entry.data.payment_term.toDateString() ]);
  //   }
  //   if (entry.data.kind === "exchange") {
  //     ret.push([
  //       entry.date.toDateString(),
  //       entry.description,
  //       entry.data.credit_account.name,
  //       entry.data.debit_account.name,
  //       entry.data.debit_currency,
  //       entry.data.debit_value.toString(),
  //       entry.data.credit_account.name,
  //       entry.data.credit_value.toString(),
  //       entry.data.exchange_account.name]);
  //   }
  // }
  
  const ledger_by_date = {
    entries: new Map<[number, number], LedgerEntry[]>,
  }
  for (const entry of ledger.entries) {
    const key: [number, number] = [entry.date.getMonth(), entry.date.getFullYear()];
    const entries = ledger_by_date.entries.get(key);
    if (entries !== undefined) {
      entries.push(entry);
    } else {
      ledger_by_date.entries.set(key, [entry]);
    }
  }
  // for (const [key, entries] of ledger_by_date.entries) {
  //   ret.push([key.toString()])
  //   for(const entry of entries) {
  //     if (entry.data.kind === "default") {
  //       ret.push([entry.date.toDateString(), entry.description, entry.data.credit_account.name, entry.data.debit_account.name, entry.data.currency, entry.data.value.toString() ]);
  //     }
  //     if (entry.data.kind === "liability") {
  //       ret.push([entry.date.toDateString(), entry.description, entry.data.credit_account.name, entry.data.debit_account.name, entry.data.currency, entry.data.value.toString(), entry.data.payment_term.toDateString() ]);
  //     }
  //     if (entry.data.kind === "exchange") {
  //       ret.push([
  //         entry.date.toDateString(),
  //         entry.description,
  //         entry.data.credit_account.name,
  //         entry.data.debit_account.name,
  //         entry.data.debit_currency,
  //         entry.data.debit_value.toString(),
  //         entry.data.credit_account.name,
  //         entry.data.credit_value.toString(),
  //         entry.data.exchange_account.name]);
  //     }
  //   }
  // }
  
  const key_hash = (account: Account, currency: string, date: [number, number]): string => `${account.name}-${currency}-${date.toString()}`;
  const ledger_by_date_and_account = {
    entries: new Map<string, AccountEntry[]>, 
  };
  
  for (const [key, ledger_entries] of ledger_by_date.entries) {
    for (const ledger_entry of ledger_entries) {
      const kind = ledger_entry.data.kind;
      if (kind === "default" || kind === "liability") {
        const currency = ledger_entry.data.currency;
        const credit_acc = ledger_entry.data.credit_account;
        const credit_entry: AccountEntry = {
          date: ledger_entry.date,
          description: ledger_entry.description,
          type: "credit",
          value: ledger_entry.data.value,
        };

        const credit_account_entries = ledger_by_date_and_account.entries.get(key_hash(credit_acc, currency, key));
        if (credit_account_entries !== undefined) {
          credit_account_entries.push(credit_entry);
        } else {
          ledger_by_date_and_account.entries.set(key_hash(credit_acc, currency, key), [credit_entry]);
        }

        const debit_acc = ledger_entry.data.debit_account;
        const debit_entry: AccountEntry = {
          date: ledger_entry.date,
          description: ledger_entry.description,
          type: "debit",
          value: ledger_entry.data.value,
        };

        const debit_account_entries = ledger_by_date_and_account.entries.get(key_hash(debit_acc, currency, key));
        if (debit_account_entries !== undefined) {
          debit_account_entries.push(debit_entry);
        } else {
          ledger_by_date_and_account.entries.set(key_hash(debit_acc, currency, key), [debit_entry]);
        }
      } else if (kind === "exchange") {
        const credit_currency = ledger_entry.data.credit_currency;
        const credit_acc = ledger_entry.data.credit_account;
        const credit_entry: AccountEntry = {
          date: ledger_entry.date,
          description: ledger_entry.description,
          type: "credit",
          value: ledger_entry.data.credit_value,
        };
        const credit_account_entries = ledger_by_date_and_account.entries.get(key_hash(credit_acc, credit_currency, key));
        if (credit_account_entries !== undefined) {
          credit_account_entries.push(credit_entry);
        } else {
          ledger_by_date_and_account.entries.set(key_hash(credit_acc, credit_currency, key), [credit_entry]);
        }

        const debit_currency = ledger_entry.data.debit_currency;
        const debit_acc = ledger_entry.data.debit_account;
        const debit_entry: AccountEntry = {
          date: ledger_entry.date,
          description: ledger_entry.description,
          type: "debit",
          value: ledger_entry.data.debit_value,
        };
        const debit_account_entries = ledger_by_date_and_account.entries.get(key_hash(debit_acc, debit_currency, key));
        if (debit_account_entries !== undefined) {
          debit_account_entries.push(debit_entry);
        } else {
          ledger_by_date_and_account.entries.set(key_hash(debit_acc, debit_currency, key), [debit_entry]);
        }

        const exchange_account = ledger_entry.data.exchange_account;
        const exchange_debit_entry: AccountEntry = {
          date: ledger_entry.date,
          description: ledger_entry.description,
          type: "debit",
          value: ledger_entry.data.credit_value,
        };
        const exchange_debit_account_entries = ledger_by_date_and_account.entries.get(key_hash(exchange_account, credit_currency, key));
        if (exchange_debit_account_entries !== undefined) {
          exchange_debit_account_entries.push(exchange_debit_entry);
        } else {
          ledger_by_date_and_account.entries.set(key_hash(exchange_account, credit_currency, key), [exchange_debit_entry]);
        }
        const exchange_credit_entry: AccountEntry = {
          date: ledger_entry.date,
          description: ledger_entry.description,
          type: "credit",
          value: ledger_entry.data.debit_value,
        };
        const exchange_credit_account_entries = ledger_by_date_and_account.entries.get(key_hash(exchange_account, debit_currency, key));
        if (exchange_credit_account_entries !== undefined) {
          exchange_credit_account_entries.push(exchange_credit_entry);
        } else {
          ledger_by_date_and_account.entries.set(key_hash(exchange_account, debit_currency, key), [exchange_credit_entry]);
        }
      }
    }
  }
  
  const begin_date = ledger.entries[0].date;
  const begin_month = begin_date.getMonth(); 
  const begin_year = begin_date.getFullYear(); 
  const begin: [number, number] = [begin_month, begin_year];
  const end_date = ledger.entries[ledger.entries.length - 1].date;
  const roll_over = end_date.getMonth() + 1 === 12; 
  const end_month = roll_over ? 0 : end_date.getMonth() + 1;
  const end_year = roll_over ? end_date.getFullYear() + 1 : end_date.getFullYear(); 
  const end: [number, number] = [end_month, end_year];
  
  for (const currency of currencies) {
    ret.push(["currency", currency]);
    const months = [...generate_months(begin, end)].reverse();
    const months_header: any[] = [""];
    for (const [month, year] of months) {
      months_header.push(new Date(year, month))
    }
    ret.push(months_header);
    for (const [account, account_type] of account_tree.root_accounts) {
      if (account_type.statement === "income_statement") {
        pre_order_traversal(account, (acc) => {
          const ret_entry: any[] = [acc.name];
          for (const key of months) {
            const entries = ledger_by_date_and_account.entries.get(key_hash(acc, currency, key));
            let total = 0;
            if(entries !== undefined) {
              for(const entry of entries) {
                if (account_type.kind == "normal_credit") {
                  if (entry.type === "credit") {
                    total += entry.value;
                  } else {
                    total -= entry.value;
                  }
                } else {
                  if (entry.type === "debit") {
                    total += entry.value;
                  } else {
                    total -= entry.value;
                  }
                }
              }
            }
            ret_entry.push(total);
          }
          ret.push(ret_entry);
        });
      }
    }
  }

  return ret;
}

function *generate_months(
  [begin_month, begin_year]: [number, number],
  [end_month, end_year]: [number, number]
  ): IterableIterator<[number, number]> {
    let year = begin_year;
    let month = begin_month;
    while (true) {
      yield [month, year];
      month = month + 1;
      if (month % 12 === 0)  {
        month = 0;
        year = year + 1;
      }
      if (year === end_year && month === end_month) {
        break;
      }
    }
}

function collect_account_names(account_list: string[], current_acc: string | null, account: Account) {
  account_list.push((current_acc === null? "" : current_acc) + account.name);
  let next_acc_prefix = current_acc === null ? "\t\t" : current_acc + "\t\t";
  for (const children of account.children) {
    collect_account_names(account_list, next_acc_prefix, children);
  }
}

