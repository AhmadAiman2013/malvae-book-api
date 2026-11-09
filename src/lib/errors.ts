/** True if `e` (or anything in its cause chain) is a SQLite UNIQUE/PK violation, optionally on a given column. */
export function isUniqueViolation(e: unknown, column?: string): boolean {
    for (let err: any = e, i = 0; err && i < 6; err = err.cause, i++) {
        const msg = String(err.message ?? '');
        if (/UNIQUE constraint failed/i.test(msg) && (!column || msg.includes(column))) return true;
    }
    return false;
}
