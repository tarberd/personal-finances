import { Account } from './Account';
import { Currency } from './Currency';

export type RawEntry = {
  date: Date;
  description: string;
  data:
    | {
        kind: 'default';
        debitAccount: Account;
        creditAccount: Account;
        currency: Currency;
        value: number;
      }
    | {
        kind: 'liability';
        debitAccount: Account;
        creditAccount: Account;
        currency: Currency;
        value: number;
        paymentTerm: Date;
      }
    | {
        kind: 'exchange';
        debitAccount: Account;
        creditAccount: Account;
        exchangeAccount: Account;
        debitValue: number;
        debitCurrency: Currency;
        creditValue: number;
        creditCurrency: Currency;
      };
};

export type Entry = {
  account: Account;
  date: Date;
  term?: Date;
  type: 'debit' | 'credit';
  currency: Currency;
  value: number;
  metadata: {
    originalEntry: RawEntry;
  };
};

export const processRawEntries = (rawEntries: RawEntry[]): Entry[] =>
  rawEntries.flatMap((rawEntry) => {
    const kind = rawEntry.data.kind;
    if (kind === 'default') {
      return [
        {
          account: rawEntry.data.creditAccount,
          date: rawEntry.date,
          type: 'credit',
          currency: rawEntry.data.currency,
          value: rawEntry.data.value,
          metadata: {
            originalEntry: rawEntry,
          },
        },
        {
          account: rawEntry.data.debitAccount,
          date: rawEntry.date,
          type: 'debit',
          currency: rawEntry.data.currency,
          value: rawEntry.data.value,
          metadata: {
            originalEntry: rawEntry,
          },
        },
      ];
    } else if (kind === 'liability') {
      return [
        {
          account: rawEntry.data.creditAccount,
          date: rawEntry.date,
          term: rawEntry.data.paymentTerm,
          type: 'credit',
          currency: rawEntry.data.currency,
          value: rawEntry.data.value,
          metadata: {
            originalEntry: rawEntry,
          },
        },
        {
          account: rawEntry.data.debitAccount,
          date: rawEntry.date,
          term: rawEntry.data.paymentTerm,
          type: 'debit',
          currency: rawEntry.data.currency,
          value: rawEntry.data.value,
          metadata: {
            originalEntry: rawEntry,
          },
        },
      ];
    } else if (kind === 'exchange') {
      return [
        {
          account: rawEntry.data.creditAccount,
          date: rawEntry.date,
          type: 'credit',
          currency: rawEntry.data.creditCurrency,
          value: rawEntry.data.creditValue,
          metadata: {
            originalEntry: rawEntry,
          },
        },
        {
          account: rawEntry.data.debitAccount,
          date: rawEntry.date,
          type: 'debit',
          currency: rawEntry.data.debitCurrency,
          value: rawEntry.data.debitValue,
          metadata: {
            originalEntry: rawEntry,
          },
        },
        {
          account: rawEntry.data.exchangeAccount,
          date: rawEntry.date,
          type: 'debit',
          currency: rawEntry.data.creditCurrency,
          value: rawEntry.data.creditValue,
          metadata: {
            originalEntry: rawEntry,
          },
        },
        {
          account: rawEntry.data.exchangeAccount,
          date: rawEntry.date,
          type: 'credit',
          currency: rawEntry.data.debitCurrency,
          value: rawEntry.data.debitValue,
          metadata: {
            originalEntry: rawEntry,
          },
        },
      ];
    }
    return [];
  });
