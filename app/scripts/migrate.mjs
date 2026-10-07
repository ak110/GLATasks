import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { getDatabaseUrl } from "./database-config.mjs";

const connection = await mysql.createConnection({
    uri: getDatabaseUrl(),
    multipleStatements: true,
});
try {
    console.log("DBマイグレーションを実行します。");
    await migrate(drizzle(connection), {
        migrationsFolder: fileURLToPath(
            new URL("../../drizzle/migrations", import.meta.url),
        ),
    });
    console.log("DBマイグレーションが完了しました。");
} finally {
    await connection.end();
}
