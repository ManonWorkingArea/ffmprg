const { createApp } = Vue

const app = createApp({
  data() {
    return {
      tasks: [],
      refreshInterval: null,
      stats: {
        total: 0,
        processing: 0,
        completed: 0,
        error: 0
      }
    }
  },
  
  mounted() {
    this.fetchTasks()
    // อัพเดทสถานะทุก 5 วินาที
    this.refreshInterval = setInterval(this.fetchTasks, 5000)
  },

  beforeUnmount() {
    clearInterval(this.refreshInterval)
  },

  methods: {
    async fetchTasks() {
      try {
        const response = await fetch('/tasks')
        const data = await response.json()
        this.tasks = data.tasks
        this.updateStats()
      } catch (error) {
        console.error('เกิดข้อผิดพลาดในการดึงข้อมูล:', error)
      }
    },

    updateStats() {
      this.stats = {
        total: this.tasks.length,
        processing: this.tasks.filter(t => t.status === 'processing').length,
        completed: this.tasks.filter(t => t.status === 'completed').length,
        error: this.tasks.filter(t => t.status === 'error').length
      }
    },

    async stopTask(taskId) {
      try {
        await fetch(`/stop/${taskId}`, { method: 'POST' })
        this.fetchTasks()
      } catch (error) {
        console.error('เกิดข้อผิดพลาดในการหยุดงาน:', error)
      }
    },

    getStatusColor(status) {
      const colors = {
        'queued': 'bg-yellow-100 text-yellow-800 border-yellow-200',
        'processing': 'bg-blue-100 text-blue-800 border-blue-200',
        'completed': 'bg-green-100 text-green-800 border-green-200',
        'error': 'bg-red-100 text-red-800 border-red-200',
        'stopped': 'bg-gray-100 text-gray-800 border-gray-200'
      }
      return colors[status] || 'bg-gray-100 text-gray-800 border-gray-200'
    },

    getStatusIcon(status) {
      const icons = {
        'queued': 'fas fa-clock',
        'processing': 'fas fa-spinner fa-spin',
        'completed': 'fas fa-check',
        'error': 'fas fa-exclamation-triangle',
        'stopped': 'fas fa-stop'
      }
      return icons[status] || 'fas fa-question'
    },

    formatDate(date) {
      return new Date(date).toLocaleString('th-TH')
    }
  },

  template: `
    <div class="min-h-screen bg-gray-50 py-8">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <!-- Header -->
        <div class="mb-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-4">ระบบจัดการการแปลงวิดีโอ</h1>
          
          <!-- Stats Cards -->
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="bg-white rounded-lg shadow p-4">
              <div class="flex items-center">
                <div class="p-3 rounded-full bg-blue-100">
                  <i class="fas fa-tasks text-blue-500"></i>
                </div>
                <div class="ml-4">
                  <p class="text-sm text-gray-500">งานทั้งหมด</p>
                  <p class="text-xl font-semibold">{{ stats.total }}</p>
                </div>
              </div>
            </div>
            
            <div class="bg-white rounded-lg shadow p-4">
              <div class="flex items-center">
                <div class="p-3 rounded-full bg-yellow-100">
                  <i class="fas fa-spinner text-yellow-500"></i>
                </div>
                <div class="ml-4">
                  <p class="text-sm text-gray-500">กำลังประมวลผล</p>
                  <p class="text-xl font-semibold">{{ stats.processing }}</p>
                </div>
              </div>
            </div>
            
            <div class="bg-white rounded-lg shadow p-4">
              <div class="flex items-center">
                <div class="p-3 rounded-full bg-green-100">
                  <i class="fas fa-check text-green-500"></i>
                </div>
                <div class="ml-4">
                  <p class="text-sm text-gray-500">เสร็จสมบูรณ์</p>
                  <p class="text-xl font-semibold">{{ stats.completed }}</p>
                </div>
              </div>
            </div>
            
            <div class="bg-white rounded-lg shadow p-4">
              <div class="flex items-center">
                <div class="p-3 rounded-full bg-red-100">
                  <i class="fas fa-exclamation-triangle text-red-500"></i>
                </div>
                <div class="ml-4">
                  <p class="text-sm text-gray-500">ผิดพลาด</p>
                  <p class="text-xl font-semibold">{{ stats.error }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Task List -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h2 class="text-xl font-semibold mb-4">รายการงานทั้งหมด</h2>
            
            <div class="space-y-4">
              <div v-for="task in tasks" :key="task.taskId" 
                   class="border rounded-lg p-4 transition-all duration-200 hover:shadow-md"
                   :class="getStatusColor(task.status)">
                
                <div class="flex justify-between items-start">
                  <div class="space-y-2">
                    <div class="flex items-center space-x-2">
                      <i :class="getStatusIcon(task.status)" class="text-lg"></i>
                      <span class="font-medium">{{ task.taskId }}</span>
                    </div>
                    
                    <div class="text-sm space-y-1">
                      <p>คุณภาพ: {{ task.quality }}</p>
                      <p>สร้างเมื่อ: {{ formatDate(task.createdAt) }}</p>
                      <p>สถานะ: {{ task.status }}</p>
                    </div>
                  </div>
                  
                  <div class="flex items-center space-x-2">
                    <div v-if="task.status === 'processing'" class="text-right">
                      <div class="w-32 bg-gray-200 rounded-full h-2 mb-1">
                        <div class="bg-blue-600 h-2 rounded-full" 
                             :style="{ width: task.percent + '%' }"></div>
                      </div>
                      <p class="text-sm">{{ task.percent }}%</p>
                    </div>
                    
                    <button v-if="task.status === 'processing'"
                            @click="stopTask(task.taskId)"
                            class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors">
                      <i class="fas fa-stop mr-1"></i> หยุด
                    </button>
                    
                    <a v-if="task.status === 'completed'" 
                       :href="'/outputs/' + task.taskId + '-output.mp4'"
                       class="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors">
                      <i class="fas fa-download mr-1"></i> ดาวน์โหลด
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})

app.mount('#app') 