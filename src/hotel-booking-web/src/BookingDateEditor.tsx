import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, dateAfter, errorMessage, money, nights } from './api'
import type { Booking, Room, Stay } from './api'

interface Props {
  booking: Booking
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onClose: () => void
  onSaved: (booking: Booking, previewTotal: number) => void
}

export default function BookingDateEditor({ booking, busy, onBusyChange, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<Stay>({ checkIn: booking.checkIn, checkOut: booking.checkOut })
  const [rate, setRate] = useState<number | null>(null)
  const [rateError, setRateError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [retry, setRetry] = useState(0)
  const checkInRef = useRef<HTMLInputElement>(null)
  const numberOfNights = nights(draft)
  const validDates = /^\d{4}-\d{2}-\d{2}$/.test(draft.checkIn) &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.checkOut) &&
    draft.checkIn >= dateAfter(0) && Number.isInteger(numberOfNights) && numberOfNights > 0
  const previewTotal = rate === null || !validDates ? null : Math.round(rate * 100) * numberOfNights / 100

  useEffect(() => { checkInRef.current?.focus() }, [])

  useEffect(() => {
    const controller = new AbortController()
    setRate(null)
    setRateError('')
    api<Room[]>('/rooms', { signal: controller.signal })
      .then(rooms => {
        const room = rooms.find(item => item.id === booking.roomId)
        if (!room) throw new Error('The room price could not be found. Refresh the bookings list and try again.')
        setRate(room.nightlyRate)
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setRateError(errorMessage(error)) })
    return () => controller.abort()
  }, [booking.roomId, retry])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (!validDates) {
      setSaveError('Choose a check-in of today or later and a check-out after check-in.')
      return
    }
    if (previewTotal === null) {
      setSaveError('The room price is unavailable. Retry loading it before saving.')
      return
    }
    onBusyChange(true)
    setSaveError('')
    try {
      const updated = await api<Booking>(`/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      onSaved(updated, previewTotal)
    } catch (error) {
      setSaveError(errorMessage(error))
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <form className="amendment-form" id={`edit-form-${booking.id}`} aria-labelledby={`edit-title-${booking.id}`} onSubmit={save}>
      <h4 id={`edit-title-${booking.id}`}>Change dates for {booking.roomName}</h4>
      <p className="muted small">Booking #{booking.id} stays in place until the new dates are saved. Hotel calendar: UTC.</p>
      <fieldset disabled={busy}>
        <legend className="sr-only">New stay dates</legend>
        <div className="amendment-dates">
          <label>Check-in<input ref={checkInRef} type="date" required min={dateAfter(0)} max="9999-12-31" value={draft.checkIn}
            onChange={event => { setDraft({ ...draft, checkIn: event.target.value }); setSaveError('') }} /></label>
          <label>Check-out<input type="date" required min={draft.checkIn || dateAfter(0)} max="9999-12-31" value={draft.checkOut}
            onChange={event => { setDraft({ ...draft, checkOut: event.target.value }); setSaveError('') }} /></label>
        </div>
        <div className="amendment-preview" aria-live="polite" aria-atomic="true">
          {rateError ? <p className="error" role="alert">{rateError}</p>
            : rate === null ? <p role="status">Loading the current room rate...</p>
              : previewTotal === null ? <p>Choose valid dates to see your new total.</p>
                : <p>{numberOfNights} {numberOfNights === 1 ? 'night' : 'nights'} &times; {money(rate)} / night<br /><strong>New total: {money(previewTotal)}</strong></p>}
        </div>
        {rateError && <button className="secondary" type="button" onClick={() => setRetry(value => value + 1)}>Retry room rate</button>}
        {rate !== null && <p className="muted small">The current room rate is confirmed when you save.</p>}
        {saveError && <p className="error" role="alert">{saveError}</p>}
        <div className="amendment-actions">
          <button className="primary" type="submit" disabled={rate === null}>{busy ? 'Saving dates...' : 'Save dates'}</button>
          <button className="secondary" type="button" onClick={onClose}>Keep existing dates</button>
        </div>
      </fieldset>
    </form>
  )
}
