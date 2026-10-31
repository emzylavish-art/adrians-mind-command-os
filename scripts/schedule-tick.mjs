#!/usr/bin/env node
console.log("Schedule tick: no hosted worker is running. No job was executed. Start this only on a process that can reach the database, and do not treat a browser timer as the scheduler.");
process.exit(0);
