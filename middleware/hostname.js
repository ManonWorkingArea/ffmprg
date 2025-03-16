const mongoose = require('mongoose');

// Define Hostname schema and model
const hostnameSchema = new mongoose.Schema({
    hostname: String,
    siteName: String,
    spaceId: String // Change to String instead of ObjectId reference
  });
  
  // Specify the collection name explicitly
  const Hostname = mongoose.model('hostname', hostnameSchema, 'hostname'); // Specify collection name as 'hostname'

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

const Space = mongoose.model('space', spaceSchema, 'space'); // Specify collection name as 'hostname'

/**
 * Fetch hostname data and join with space data
 * @param {String} site - The hostname to search for
 * @returns {Object} - Hostname data with joined space data
 */
const getHostnameData = async (site) => {
  if (!site) {
    throw new Error('Site is required');
  }
  console.log(site);
  try {
    const hostnameData = await Hostname.findOne({ hostname: site })
      .select('hostname siteName spaceId') // Select only required fields
      .populate('spaceId', 'name s3Bucket s3Endpoint s3EndpointDefault s3Hosting s3Region status spaceSize count size'); // Populate space details

    if (!hostnameData) {
      return null; // Return null if no data found
    }

    return hostnameData; // คืนค่าข้อมูล hostname พร้อมข้อมูล space
  } catch (error) {
    console.error('Error fetching hostname data:', error);
    throw new Error('Failed to fetch hostname data');
  }
};

/**
 * Fetch space data by spaceId
 * @param {String} spaceId - The ID of the space to search for
 * @returns {Object} - Space data
 */
const getSpaceData = async (spaceId) => {
  if (!spaceId) {
    throw new Error('Space ID is required');
  }
  //console.log('Fetching space data for spaceId:', spaceId); // เพิ่มการบันทึกเพื่อดีบัก
  try {
    const spaceData = await Space.findOne({_id: new mongoose.Types.ObjectId(spaceId)}); // ใช้ new เพื่อสร้าง ObjectId

    if (!spaceData) {
      console.warn('No space data found for spaceId:', spaceId); // เพิ่มการบันทึกเมื่อไม่พบข้อมูล
      return null; // คืนค่า null หากไม่พบข้อมูล
    }

    return spaceData; // คืนค่าข้อมูล space
  } catch (error) {
    console.error('Error fetching space data:', error);
    throw new Error('Failed to fetch space data');
  }
};

module.exports = { getHostnameData, getSpaceData };
