declare module 'better-sqlite3' {
  interface Statement {
    get(...params: any[]): any
    all(...params: any[]): any[]
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint }
  }

  interface Database {
    prepare(sql: string): Statement
    pragma(pragma: string): any
    close(): void
  }

  interface DatabaseOptions {
    readonly?: boolean
    fileMustExist?: boolean
    timeout?: number
    verbose?: (message?: unknown, ...additional: unknown[]) => void
    nativeBinding?: string
  }

  const Database: {
    new (filename: string, options?: DatabaseOptions): Database
  }

  export default Database
}
