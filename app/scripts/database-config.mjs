/** アプリと運用コマンドのDB接続URLを解決する。 */
export function getDatabaseUrl() {
    const value = process.env.DATABASE_URL;
    if (!value) {
        throw new Error("DATABASE_URLを指定してから再実行してください。");
    }
    const url = new URL(value);
    if (!url.username) {
        const credential = process.env.DB_CREDENTIAL;
        if (!credential) {
            throw new Error("DB_CREDENTIALを指定してから再実行してください。");
        }
        url.username = credential;
        url.password = credential;
    }
    return url.href;
}
