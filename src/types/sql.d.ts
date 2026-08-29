declare module 'sql.js' {
  export type BindParams = Array<string | number | null | Uint8Array>
  export type SqlValue = string | number | null | Uint8Array

  export interface Database {
    run(sql: string, params?: BindParams): Database
    exec(sql: string, params?: BindParams): Array<{ columns: string[]; values: SqlValue[][] }>
    prepare(sql: string, params?: BindParams): Statement
    export(): Uint8Array
    close(): void
    getRowsModified(): number
  }

  export interface Statement {
    bind(params?: BindParams): boolean
    step(): boolean
    getAsObject(): Record<string, SqlValue>
    free(): boolean
  }

  export interface SqlJs {
    Database: new (data?: ArrayLike<number>) => Database
  }

  const initSqlJs: () => Promise<SqlJs>
  export default initSqlJs
}

declare module 'sql.js/dist/sql-asm.js' {
  import initSqlJs from 'sql.js'
  export default initSqlJs
}
