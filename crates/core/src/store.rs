//! mixmap's own SQLite database (`%APPDATA%\mixmap\mixmap.db`), exposed as a thin,
//! generic bridge. Schema, migrations and all queries live in TypeScript
//! (`ui/src/db`); Rust only opens the file and runs statements.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};

use crate::Error;

pub struct Store {
    conn: Mutex<Connection>,
}

/// One statement with positional (`?`) parameters.
#[derive(Debug, Deserialize)]
pub struct Statement {
    #[serde(default)]
    pub params: Vec<Json>,
    pub sql: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub changes: usize,
    pub last_insert_rowid: i64,
}

impl Store {
    /// Open (or create) the database file, creating its folder if needed.
    pub fn open(path: &Path) -> Result<Self, Error> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| Error::Invalid(format!("cannot create {}: {e}", dir.display())))?;
        }
        let conn = Connection::open(path).map_err(db_err)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self, Error> {
        Self::init(Connection::open_in_memory().map_err(db_err)?)
    }

    fn init(conn: Connection) -> Result<Self, Error> {
        // busy_timeout first, so switching to WAL waits for other connections.
        conn.execute_batch(
            "PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; \
             PRAGMA trusted_schema = OFF;",
        )
        .map_err(db_err)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Run a query and return rows as JSON objects (column name → value).
    pub fn query(&self, stmt: &Statement) -> Result<Vec<Map<String, Json>>, Error> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut prepared = conn.prepare(&stmt.sql).map_err(db_err)?;
        let names: Vec<String> = prepared.column_names().map(|s| s.to_string()).collect();
        let mut rows = prepared
            .query(params_from_iter(stmt.params.iter().map(to_sql)))
            .map_err(db_err)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(db_err)? {
            let mut obj = Map::new();
            for (i, name) in names.iter().enumerate() {
                obj.insert(name.clone(), from_sql(row.get_ref(i).map_err(db_err)?));
            }
            out.push(obj);
        }
        Ok(out)
    }

    /// Run statements in one transaction: all or nothing.
    pub fn execute(&self, stmts: &[Statement]) -> Result<Vec<ExecResult>, Error> {
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction().map_err(db_err)?;
        let mut results = Vec::with_capacity(stmts.len());
        for stmt in stmts {
            let changes = tx
                .execute(&stmt.sql, params_from_iter(stmt.params.iter().map(to_sql)))
                .map_err(db_err)?;
            results.push(ExecResult {
                changes,
                last_insert_rowid: tx.last_insert_rowid(),
            });
        }
        tx.commit().map_err(db_err)?;
        Ok(results)
    }
}

fn db_err(e: rusqlite::Error) -> Error {
    Error::Invalid(format!("mixmap database: {e}"))
}

fn to_sql(v: &Json) -> Value {
    match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => n
            .as_i64()
            .map(Value::Integer)
            .unwrap_or_else(|| Value::Real(n.as_f64().unwrap_or(0.0))),
        Json::String(s) => Value::Text(s.clone()),
        // Arrays/objects are stored as JSON text.
        other => Value::Text(other.to_string()),
    }
}

fn from_sql(v: ValueRef) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => Json::from(f),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::String(b.iter().map(|x| format!("{x:02x}")).collect()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn st(sql: &str, params: Json) -> Statement {
        Statement {
            params: serde_json::from_value(params).unwrap(),
            sql: sql.into(),
        }
    }

    #[test]
    fn query_and_execute_round_trip() {
        let s = Store::open_in_memory().unwrap();
        let r = s
            .execute(&[
                st("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score REAL, tags TEXT, n INT)", json!([])),
                st("INSERT INTO t (name, score, tags, n) VALUES (?, ?, ?, ?)", json!(["a", 1.5, ["x", "y"], null])),
                st("INSERT INTO t (name, score, tags, n) VALUES (?, ?, ?, ?)", json!(["b", 2, null, true])),
            ])
            .unwrap();
        assert_eq!(
            r[2],
            ExecResult {
                changes: 1,
                last_insert_rowid: 2
            }
        );
        let rows = s
            .query(&st(
                "SELECT * FROM t WHERE score > ? ORDER BY id",
                json!([1]),
            ))
            .unwrap();
        assert_eq!(
            Json::from(
                rows.clone()
                    .into_iter()
                    .map(Json::Object)
                    .collect::<Vec<_>>()
            ),
            json!([
                {"id": 1, "name": "a", "score": 1.5, "tags": "[\"x\",\"y\"]", "n": null},
                {"id": 2, "name": "b", "score": 2.0, "tags": null, "n": 1},
            ])
        );
    }

    #[test]
    fn execute_is_all_or_nothing() {
        let s = Store::open_in_memory().unwrap();
        s.execute(&[st("CREATE TABLE t (v TEXT UNIQUE)", json!([]))])
            .unwrap();
        let err = s.execute(&[
            st("INSERT INTO t VALUES ('a')", json!([])),
            st("INSERT INTO t VALUES ('a')", json!([])),
        ]);
        assert!(err.is_err());
        let rows = s
            .query(&st("SELECT count(*) AS n FROM t", json!([])))
            .unwrap();
        assert_eq!(rows[0]["n"], 0);
    }

    #[test]
    fn opens_a_file_and_creates_its_folder() {
        let dir = std::env::temp_dir().join(format!("mixmap-store-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let path = dir.join("sub").join("mixmap.db");
        {
            let s = Store::open(&path).unwrap();
            s.execute(&[st("CREATE TABLE t (v)", json!([]))]).unwrap();
        }
        assert!(path.is_file());
        std::fs::remove_dir_all(dir).ok();
    }
}
