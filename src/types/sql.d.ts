declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: any[]): void
    exec(sql: string): void
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
  }

  export interface Statement {
    step(): boolean
    getAsObject(): Record<string, any>
    free(): void
  }

  export interface SqlJs {
    Database: {
      new (data?: ArrayLike<number>): Database
    }
  }

  const initSqlJs: () => Promise<SqlJs>
  export default initSqlJs
}
