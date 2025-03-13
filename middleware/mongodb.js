const mongoose = require('mongoose');

// เชื่อมต่อกับ MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://vue:Qazwsx1234!!@cloudmongodb.wpc62e9.mongodb.net/API', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB :: Connected.');
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err);
});

// สร้าง Schema และ Model สำหรับคิว
const taskSchema = new mongoose.Schema({
  taskId: String,
  status: String,
  quality: String,
  createdAt: Date,
  inputPath: String,
  outputFile: String,
  percent: Number,
  url: String
});

const Task = mongoose.model('Queue', taskSchema);

const MongoDB = {
  async createTask(data) {
    return await Task.create(data);
  },

  async getTaskById(taskId) {
    return await Task.findOne({ taskId });
  },

  async getTaskByInputPath(inputPath) {
    return await Task.findOne({ inputPath });
  },

  async getTaskByUrl(url) {
    return await Task.findOne({ url });
  },

  async getAllTasks() {
    return await Task.find();
  },

  async updateTask(taskId, updateData) {
    return await Task.updateOne({ taskId }, updateData);
  },

  async deleteTask(taskId) {
    return await Task.deleteOne({ taskId });
  },

  async getNextQueuedTask() {
    return await Task.findOneAndDelete({ status: 'queued' });
  }
};

module.exports = MongoDB;