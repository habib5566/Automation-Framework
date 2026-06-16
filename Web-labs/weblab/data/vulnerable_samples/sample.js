// Deliberately vulnerable sample (JavaScript / Node) -- AUTHORIZED lab.
// Each numbered comment marks a PLANTED weakness for the SAST module to detect.
// Do NOT run this; it is a static-analysis scan target only.
const express = require("express");
const { exec } = require("child_process");
const db = require("./db");

const app = express();

// [VULN] hardcoded JWT secret / API key
const JWT_SECRET = "supersecret_jwt_signing_key_do_not_share";
const API_KEY = "AKIAIOSFODNN7EXAMPLE";

app.get("/user", (req, res) => {
  // [VULN] SQL built via template literal -> SQL injection
  db.query(`SELECT * FROM users WHERE id = ${req.query.id}`);
  // [VULN] SQL built via + concatenation -> SQL injection
  db.query("SELECT * FROM logs WHERE u = '" + req.query.u + "'");
});

app.get("/ping", (req, res) => {
  // [VULN] child_process.exec on user input -> command injection
  exec("ping -c 1 " + req.query.host, (e, out) => res.send(out));
});

app.get("/calc", (req, res) => {
  // [VULN] eval / Function on input -> code injection
  const r = eval(req.query.expr);
  const f = new Function("return " + req.query.body);
  res.send(String(r) + f());
});

app.get("/hello", (req, res) => {
  // [VULN] res.send of untrusted input -> reflected XSS
  res.send("<h1>Hello " + req.query.name + "</h1>");
  // [VULN] innerHTML of untrusted input -> XSS (DOM, when bundled to client)
  document.getElementById("out").innerHTML = req.query.html;
});

app.get("/load", (req, res) => {
  // [VULN] require() of user input -> arbitrary module load
  const mod = require(req.query.plugin);
  res.send(mod.name);
});

app.listen(3000);
