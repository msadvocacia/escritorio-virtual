const DataCollection = require('../models/DataCollection');

async function getCollection(name, defaultValue = []) {
  const doc = await DataCollection.findOne({ name });
  if (!doc) return defaultValue;
  return doc.data;
}

async function setCollection(name, data) {
  await DataCollection.findOneAndUpdate(
    { name },
    { $set: { data } },
    { upsert: true, new: true }
  );
  return data;
}

module.exports = { getCollection, setCollection };
