type Ledger = null;

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

const find_account = (account: Account, name: string): Account | undefined => {
  return undefined;
}

const find_account_in_account_tree = (account_tree: AccountTree, name: string): Account | undefined => {
  for (const [account, ] of account_tree.root_accounts) {
    if (account.name === name) {
      return account;
    }
  }
  return undefined;
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
    let statement: "balance_sheet" | "income_statement" = is_part_of_net_revenue === "TRUE" ? "income_statement" : "balance_sheet";
    account_tree.root_accounts.push([new_root_acc(root_acc_name), {kind: kind, statement: statement}]);
  }

  for (const account_table_entry of account_table.filter(non_empty_row_filter)) {
    add_account_table_entry_to_account_tree(account_tree, account_table_entry.filter(non_empty_cell_filter))
  }
  return account_tree;
}

type LedgerEntry = {
  date: Date,
  description: string,
  credit_account: Account,
  debit_account: Account,
  value: number,
}

interface GeneralLedger {
  kind: "GeneralLedger",
  entries: LedgerEntry[],
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function create_monthly_income_statement(
  account_types: string[][],
  account_table: string[][],
  currencies: string[],
  ...ledger_tables: string[][][]
): string[][] {
  const currency_set = currencies.reduce((previous, current) => {
    previous.add(current);
    return previous;
  }, new Set<string>());

  const ret: string[][] = [];
  
  const account_tree = make_account_tree(account_table, account_types);
  
  for (const [account, info] of account_tree.root_accounts) {
    let account_list: string[] = [];
    collect_account_names(account_list, "", account);
    for (const name of account_list) {
      ret.push([name, info.kind, info.statement]);
    }
  }

  return ret;
}

function collect_account_names(account_list: string[], current_acc: string, account: Account) {
  account_list.push(current_acc + account.name);
  let next_acc_prefix = account.name + ":";
  for (const children of account.children) {
    collect_account_names(account_list, next_acc_prefix, children);
  }
}

