const { CosmosClient } = require("@azure/cosmos");
require("dotenv").config();

const client = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY,
});

const database = client.database(process.env.COSMOS_DATABASE_ID);

const adminsContainer = database.container(
  process.env.COSMOS_ADMINS_CONTAINER_ID
);

// 👉 להוסיף את זה
const eventsContainer = database.container(
  process.env.COSMOS_EVENTS_CONTAINER_ID
);
const eventParticipantsContainer = database.container(
  process.env.COSMOS_EVENTS_PARTICIPANTS_CONTAINER_ID
);

module.exports = {
  client,
  database,
  adminsContainer,
  eventsContainer, // 👉 להוסיף גם כאן
  eventParticipantsContainer, // 👉 להוסיף גם כאן
};