export interface Room {
  id: number
  name: string
  description: string
  capacity: number
  nightlyRate: number
  isAvailable: boolean | null
}

export interface Stay {
  checkIn: string
  checkOut: string
}

export interface Booking extends Stay {
  id: number
  roomId: number
  roomName: string
  guestName: string
  guests: number
  totalPrice: number
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options)
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    let message = `Request failed (${response.status}). Please try again.`
    if (typeof body === 'object' && body !== null) {
      if ('detail' in body && typeof body.detail === 'string') message = body.detail
      if ('errors' in body && typeof body.errors === 'object' && body.errors !== null) {
        const errors = Object.values(body.errors).flat().filter((value): value is string => typeof value === 'string')
        if (errors.length) message = errors.join(' ')
      }
    }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function dateAfter(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function nights(stay: Stay): number {
  return (Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

export const money = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
