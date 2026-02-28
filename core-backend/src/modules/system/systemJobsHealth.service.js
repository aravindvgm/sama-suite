'use strict';

const pool = require('../../config/db');

async function getJobsHealth() {
  const { rows } = await pool.query(
    `SELECT job_name, locked_by, last_run_at, last_run_status, expires_at,
            CASE WHEN expires_at > NOW() THEN true ELSE false END AS is_locked
     FROM   job_locks
     ORDER  BY job_name ASC`
  );
  return rows;
}

module.exports = { getJobsHealth };
