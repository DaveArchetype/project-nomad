import axios, { AxiosInstance } from 'axios'

export function createApiClient(): AxiosInstance {
  return axios.create({
    baseURL: '/api',
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
