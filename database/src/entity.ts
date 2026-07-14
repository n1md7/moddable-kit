import Preference from "preference";
import { Storage } from "database/storage";

/** The value types a field can hold — mirrors what Preference itself can store. */
export type FieldType = "string" | "number" | "boolean";

type TypeOf<T extends FieldType> = T extends "string"
  ? string
  : T extends "number"
    ? number
    : T extends "boolean"
      ? boolean
      : never;

export interface FieldDef<T extends FieldType = FieldType> {
  type: T;
  /** When true, the value must be supplied on `insert`. Ignored if `default` is set. */
  required?: boolean;
  /**
   * Value used when the field is omitted on `insert`. Either a constant, or a function
   * evaluated per insert — handy for dynamic values, e.g. `default: () => Date.now()`.
   */
  default?: TypeOf<T> | (() => TypeOf<T>);
}

export type Schema = Record<string, FieldDef>;

export interface EntityOptions<S extends Schema> {
  /** Preference domain the records live under. Max 32 characters. */
  name: string;
  fields: S;
}

/** A field is optional on `insert` when it has a default or is explicitly not required. */
type OptionalKeys<S extends Schema> = {
  [K in keyof S]: S[K] extends { default: unknown }
    ? K
    : S[K] extends { required: false }
      ? K
      : never;
}[keyof S];

type RequiredKeys<S extends Schema> = Exclude<keyof S, OptionalKeys<S>>;

/** A stored record: the schema fields plus the auto-assigned `id`. */
export type Row<S extends Schema> = { id: number } & {
  [K in keyof S]: TypeOf<S[K]["type"]>;
};

/** Shape accepted by `insert`: required fields mandatory, the rest optional. `id` is assigned. */
export type Insert<S extends Schema> = {
  [K in RequiredKeys<S>]: TypeOf<S[K]["type"]>;
} & {
  [K in OptionalKeys<S>]?: TypeOf<S[K]["type"]>;
};

/** Fields to change on `update` — any subset of the schema (never `id`). */
export type Patch<S extends Schema> = {
  [K in keyof S]?: TypeOf<S[K]["type"]>;
};

/** Reserved key holding the autoincrement counter. Not a valid record key (records are ints). */
const SEQ_KEY = "seq";

/**
 * A very small, TypeORM/Sequelize-flavoured wrapper over {@link Storage}/`Preference`.
 * No relationships, no queries — just typed CRUD over a flat collection of records.
 *
 * Each record is one Preference entry (domain = entity name, key = stringified id), so an
 * insert/update rewrites a single entry, not the whole table. Keep records small: every
 * record must fit within one Preference value, and Preference lives in wear-limited SPI
 * flash — see {@link Storage} for the caveat. This is for config-sized collections (a
 * handful to a few dozen small records), not a general-purpose database.
 */
export class Entity<S extends Schema> {
  private readonly domain: string;
  private readonly fields: S;
  private readonly seq: Storage<number>;

  constructor(options: EntityOptions<S>) {
    if (options.name.length > 32) {
      throw new Error("Entity name max length exceeds 32 characters");
    }
    this.domain = options.name;
    this.fields = options.fields;
    this.seq = new Storage<number>(this.domain, SEQ_KEY, 0);
  }

  /** Insert a new record. Applies defaults, validates types, assigns an autoincrement `id`. */
  insert(input: Insert<S>): Row<S> {
    const record = { id: this.nextId() } as Row<S>;
    const values = input as Record<string, unknown>;

    for (const key in this.fields) {
      const field = this.fields[key];
      let value = values[key];

      if (value === undefined) {
        if (field.default !== undefined) {
          value = typeof field.default === "function" ? field.default() : field.default;
        } else if (field.required) throw new Error(`Field "${key}" is required`);
        else continue; // no value, no default, not required
      }

      this.check(key, field.type, value);
      (record as Record<string, unknown>)[key] = value;
    }

    this.write(record.id, record);
    return record;
  }

  /** Get one record by id, or `undefined` if it does not exist. */
  findById(id: number): Row<S> | undefined {
    const raw = Preference.get(this.domain, String(id));
    if (typeof raw !== "string") return undefined;
    return JSON.parse(raw) as Row<S>;
  }

  /** All records matching the predicate (all records when omitted). */
  find(predicate?: (row: Row<S>) => boolean): Row<S>[] {
    const rows = this.all();
    return predicate ? rows.filter(predicate) : rows;
  }

  /** The first record matching the predicate, or `undefined`. */
  findOne(predicate: (row: Row<S>) => boolean): Row<S> | undefined {
    for (const key of this.recordKeys()) {
      const row = this.findById(Number(key));
      if (row && predicate(row)) return row;
    }
    return undefined;
  }

  /** Every stored record. */
  all(): Row<S>[] {
    const rows: Row<S>[] = [];
    for (const key of this.recordKeys()) {
      const row = this.findById(Number(key));
      if (row) rows.push(row);
    }
    return rows;
  }

  /** Number of stored records. */
  count(): number {
    return this.recordKeys().length;
  }

  /** Merge `patch` into an existing record. Returns the updated row, or `undefined` if absent. */
  update(id: number, patch: Patch<S>): Row<S> | undefined {
    const current = this.findById(id);
    if (!current) return undefined;

    const changes = patch as Record<string, unknown>;
    for (const key in changes) {
      const field = this.fields[key];
      if (!field) throw new Error(`Unknown field "${key}"`);
      if (changes[key] !== undefined) this.check(key, field.type, changes[key]);
    }

    const next = { ...current, ...changes, id } as Row<S>;
    this.write(id, next);
    return next;
  }

  /** Remove a record by id. Safe to call for a missing id. */
  delete(id: number): void {
    Preference.delete(this.domain, String(id));
  }

  /** Remove every record and reset the id counter. Leaves the domain empty. */
  clear(): void {
    for (const key of this.recordKeys()) Preference.delete(this.domain, key);
    this.seq.setValue(0);
  }

  private nextId(): number {
    return this.seq.setValue(this.seq.getValue()! + 1);
  }

  private write(id: number, record: Row<S>): void {
    Preference.set(this.domain, String(id), JSON.stringify(record));
  }

  /** Keys under the domain that name a record (integers) — filters out the `seq` counter. */
  private recordKeys(): string[] {
    return Preference.keys(this.domain).filter((key) => /^\d+$/.test(key));
  }

  private check(key: string, type: FieldType, value: unknown): void {
    if (typeof value !== type) {
      throw new Error(`Field "${key}" must be a ${type}, got ${typeof value}`);
    }
  }
}
