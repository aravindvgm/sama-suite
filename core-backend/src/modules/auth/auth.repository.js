"use strict";

const pool = require("../../config/db");

async function createOrganizationAndUser({
  organizationName,
  email,
  passwordHash,
  fullName
}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orgResult = await client.query(
      `INSERT INTO organizations (name)
       VALUES ($1)
       RETURNING id, name, created_at`,
      [organizationName]
    );

    const organization = orgResult.rows[0];

    const userResult = await client.query(
      `INSERT INTO users (email, password, full_name, organization_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, organization_id, created_at`,
      [email, passwordHash, fullName, organization.id]
    );

    const user = userResult.rows[0];

    await client.query("COMMIT");

    return { organization, user };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function findUserByEmailForLogin(email) {
  const { rows } = await pool.query(
    `SELECT id, email, password, full_name, organization_id, created_at
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [email]
  );

  return rows[0] || null;
}

module.exports = {
  createOrganizationAndUser,
  findUserByEmailForLogin,
};