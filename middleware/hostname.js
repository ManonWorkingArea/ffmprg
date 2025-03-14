const mongoose = require('mongoose');

// Define Hostname schema and model
const hostnameSchema = new mongoose.Schema({
  hostname: String,
  siteName: String,
  spaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Space' } // Reference to Space collection
});

const Hostname = mongoose.model('Hostname', hostnameSchema);

// Define Space schema and model
const spaceSchema = new mongoose.Schema({
  name: String,
  s3Bucket: String,
  s3Endpoint: String,
  s3EndpointDefault: String,
  s3Hosting: String,
  s3Region: String,
  status: Boolean,
  spaceSize: String,
  count: Number,
  size: Number
});

const Space = mongoose.model('Space', spaceSchema);

/**
 * Fetch hostname data and join with space data
 * @param {String} site - The hostname to search for
 * @returns {Object} - Hostname data with joined space data
 */
const getHostnameData = async (site) => {
  if (!site) {
    throw new Error('Site is required');
  }

  try {
    const hostnameData = await Hostname.findOne({ hostname: site })
      .select('hostname siteName spaceId') // Select only required fields
      .populate('spaceId', 'name s3Bucket s3Endpoint s3EndpointDefault s3Hosting s3Region status spaceSize count size'); // Populate space details

    if (!hostnameData) {
      return null; // Return null if no data found
    }

    return hostnameData;
  } catch (error) {
    console.error('Error fetching hostname data:', error);
    throw new Error('Failed to fetch hostname data');
  }
};

module.exports = { getHostnameData };
