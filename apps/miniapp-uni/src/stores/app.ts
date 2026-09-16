import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const projectName = ref('未命名图纸')

  return { projectName }
})
