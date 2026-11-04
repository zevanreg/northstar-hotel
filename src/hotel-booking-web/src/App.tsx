import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, dateAfter, errorMessage, formatDate, money, nights } from './api'
import type { Booking, Room, Stay } from './api'
import BookingDateEditor from './BookingDateEditor'

export default function App() {
  const [draft, setDraft] = useState<Stay>(() => ({ checkIn: dateAfter(7), checkOut: dateAfter(9) }))
  const [stay, setStay] = useState<Stay>(draft)
  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [roomsLoading, setRoomsLoading] = useState(true)
  const [bookingsLoading, setBookingsLoading] = useState(true)
  const [roomError, setRoomError] = useState('')
  const [bookingError, setBookingError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [bookingNotice, setBookingNotice] = useState('')
  const [selected, setSelected] = useState<Room | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [revision, setRevision] = useState(0)
  const guestNameRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const bookingsTitleRef = useRef<HTMLHeadingElement>(null)
  const dirty = draft.checkIn !== stay.checkIn || draft.checkOut !== stay.checkOut

  useEffect(() => {
    const controller = new AbortController()
    setRoomsLoading(true)
    setRoomError('')
    api<Room[]>(`/rooms?${new URLSearchParams({ ...stay })}`, { signal: controller.signal })
      .then(setRooms)
      .catch((error: unknown) => { if (!controller.signal.aborted) setRoomError(errorMessage(error)) })
      .finally(() => { if (!controller.signal.aborted) setRoomsLoading(false) })
    return () => controller.abort()
  }, [stay, revision])

  useEffect(() => {
    const controller = new AbortController()
    setBookingsLoading(true)
    setBookingError('')
    api<Booking[]>('/bookings', { signal: controller.signal })
      .then(setBookings)
      .catch((error: unknown) => { if (!controller.signal.aborted) setBookingError(errorMessage(error)) })
      .finally(() => { if (!controller.signal.aborted) setBookingsLoading(false) })
    return () => controller.abort()
  }, [revision])

  useEffect(() => { if (selected) guestNameRef.current?.focus() }, [selected])
  useEffect(() => { if (actionError) errorRef.current?.focus() }, [actionError])
  useEffect(() => {
    if (editingId !== null && !bookingsLoading && !bookingError && !bookings.some(booking => booking.id === editingId)) {
      setEditingId(null)
      setBookingNotice(`Booking #${editingId} is no longer in the list. Its dates were not changed here.`)
      bookingsTitleRef.current?.focus()
    }
  }, [editingId, bookings, bookingsLoading, bookingError])

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSelected(null)
    setActionError('')
    setNotice('')
    if (draft.checkIn < dateAfter(0) || !Number.isFinite(nights(draft)) || nights(draft) <= 0) {
      setActionError('Choose a check-in of today or later and a check-out after check-in.')
      return
    }
    setRoomsLoading(true)
    setStay({ ...draft })
  }

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || dirty || busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const booking = await api<Booking>('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: selected.id, ...stay, guestName: data.get('guestName'),
          email: data.get('email'), guests: Number(data.get('guests')),
        }),
      })
      setNotice(`You're booked. ${booking.roomName}, ${formatDate(booking.checkIn)} to ${formatDate(booking.checkOut)}. Total ${money(booking.totalPrice)}. Booking #${booking.id}.`)
      setSelected(null)
      setRevision(value => value + 1)
      searchRef.current?.focus()
    } catch (error) {
      setActionError(errorMessage(error))
      setRevision(value => value + 1)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }

  async function cancel(booking: Booking) {
    setBusy(true)
    setActionError('')
    setNotice('')
    setBookingNotice('')
    try {
      await api<void>(`/bookings/${booking.id}`, { method: 'DELETE' })
      setNotice(`Booking #${booking.id} for ${booking.roomName} has been cancelled. The room is available to book again.`)
      setConfirmCancel(null)
      setSelected(null)
      setRevision(value => value + 1)
      searchRef.current?.focus()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function closeEditor(id: number) {
    setEditingId(null)
    document.getElementById(`edit-booking-${id}`)?.focus()
  }

  function bookingUpdated(booking: Booking, previewTotal: number) {
    setEditingId(null)
    setBookings(current => current.map(item => item.id === booking.id ? booking : item))
    setBookingNotice(`Booking #${booking.id} updated: ${formatDate(booking.checkIn)} to ${formatDate(booking.checkOut)}. Total ${money(booking.totalPrice)}.${Math.round(booking.totalPrice * 100) !== Math.round(previewTotal * 100) ? ' The room rate changed since your preview.' : ''}`)
    setSelected(null)
    setRevision(value => value + 1)
    bookingsTitleRef.current?.focus()
  }

  const availableCount = rooms.filter(room => room.isAvailable).length
  return (
    <>
      <a className="skip-link" href="#main">Skip to booking</a>
      <header className="site-header wrap">
        <a className="wordmark" href="#" aria-label="Northstar Hotel home">NORTHSTAR<span>HOTEL &amp; HARBOUR</span></a>
        <nav aria-label="Main navigation"><a href="#rooms">Our rooms</a><a href="#bookings">Your bookings</a></nav>
      </header>
      <main id="main">
        <section className="hero">
          <div className="wrap hero-inner">
            <p className="eyebrow">A SMALL HOTEL. A WARM WELCOME.</p>
            <h1>A quieter<br />kind of <em>stay.</em></h1>
            <div className="hero-copy">
              <p>Harbour mornings. Thoughtful rooms.<br />A little space to feel at home.</p>
              <a className="text-link" href="#availability" onClick={() => searchRef.current?.focus()}>Find your room <span aria-hidden="true">&rarr;</span></a>
            </div>
          </div>
        </section>
        <div className="wrap content">
          <section className="search-card" id="availability" aria-labelledby="search-title">
            <div className="search-heading"><h2 id="search-title">Make yourself at home.</h2><p>Choose your dates. We will take care of the rest.</p></div>
            <form className="search-form" onSubmit={search}>
              <label>Check-in<input ref={searchRef} type="date" name="checkIn" required min={dateAfter(0)} value={draft.checkIn} disabled={busy}
                onChange={event => { setDraft({ ...draft, checkIn: event.target.value }); setSelected(null) }} /></label>
              <label>Check-out<input type="date" name="checkOut" required min={draft.checkIn || dateAfter(0)} value={draft.checkOut} disabled={busy}
                onChange={event => { setDraft({ ...draft, checkOut: event.target.value }); setSelected(null) }} /></label>
              <button type="submit" className="primary" disabled={busy || roomsLoading}>{roomsLoading ? 'Checking rooms...' : 'Find a room'}</button>
            </form>
            <p className="stay-summary">{dirty ? 'Dates changed. Select "Find a room" to update availability.' : <>Your stay: <strong>{formatDate(stay.checkIn)} &ndash; {formatDate(stay.checkOut)}</strong><span> / {nights(stay)} {nights(stay) === 1 ? 'night' : 'nights'}</span></>}<span className="date-note">Hotel calendar: UTC</span></p>
          </section>

          <div className="feedback" aria-live="polite" aria-atomic="true">{notice && <p className="success">{notice}</p>}</div>
          {actionError && <p className="error" role="alert" ref={errorRef} tabIndex={-1}>{actionError}</p>}

          <section id="rooms" className="rooms-section" aria-labelledby="rooms-title" aria-busy={roomsLoading}>
            <div className="section-heading"><div><p className="eyebrow">YOUR HARBOUR HIDEAWAY</p><h2 id="rooms-title">Room to settle in.</h2></div><p className="muted">Six rooms. Each a little different.<br />All prices in USD, per night.</p></div>
            <p className="results-status" role="status">{roomsLoading ? 'Finding rooms for your stay...' : roomError ? 'Availability could not be loaded.' : dirty ? 'Search your new dates before choosing a room.' : `${availableCount} of ${rooms.length} rooms available for your stay.`}</p>
            {roomError ? <div className="error" role="alert"><p>{roomError}</p><button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry availability</button></div>
              : !roomsLoading && rooms.length === 0 ? <p className="empty">No rooms are listed yet. Please try again shortly.</p>
              : <>
                {!roomsLoading && availableCount === 0 && <p className="empty">Every room is booked for these dates. Try another stay using the date controls above.</p>}
                <div className="room-grid">
                  {rooms.map(room => (
                    <article className={`room-card${selected?.id === room.id ? ' selected' : ''}`} key={room.id}>
                      <div className="room-topline"><span>UP TO {room.capacity} {room.capacity === 1 ? 'GUEST' : 'GUESTS'}</span><span className={room.isAvailable ? 'availability' : 'muted'}>{roomsLoading || dirty ? 'Search to confirm' : room.isAvailable ? 'Available' : 'Booked'}</span></div>
                      <h3>{room.name}</h3>
                      <p className="room-description">{room.description}</p>
                      <div className="room-bottom"><p><strong>{money(room.nightlyRate)}</strong><span> / night</span></p><button className="secondary" disabled={!room.isAvailable || roomsLoading || dirty || busy} aria-pressed={selected?.id === room.id}
                        aria-label={`Choose ${room.name}`} onClick={() => { setSelected(room); setActionError(''); setNotice('') }}>{selected?.id === room.id ? 'Selected' : 'Choose room'}</button></div>
                    </article>
                  ))}
                </div>
              </>}
          </section>

          <section className="booking-section" aria-labelledby="booking-title">
            <div><p className="eyebrow">JUST A FEW DETAILS</p><h2 id="booking-title">Your stay starts here.</h2><p className="muted">No account. No extra steps.<br />Review your stay, then make it yours.</p><p className="demo-note">Workshop demo: use fictional guest details only. Bookings are visible to everyone using this local app.</p></div>
            {selected && !dirty ? <form className="booking-form" onSubmit={book}>
              <div className="booking-summary"><h3>{selected.name}</h3><p>{formatDate(stay.checkIn)} &ndash; {formatDate(stay.checkOut)}</p><p>{nights(stay)} nights &times; {money(selected.nightlyRate)}<strong>Total {money(nights(stay) * selected.nightlyRate)}</strong></p></div>
              <fieldset disabled={busy}>
                <legend className="sr-only">Guest details</legend>
                <label>Guest name<input ref={guestNameRef} name="guestName" autoComplete="name" required maxLength={100} pattern=".*\S.*" /></label>
                <div className="guest-fields"><label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
                  <label>Guests<select name="guests" defaultValue="1">{Array.from({ length: selected.capacity }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label></div>
                <button className="primary full-width" type="submit">{busy ? 'Booking your stay...' : `Book room · ${money(nights(stay) * selected.nightlyRate)}`}</button>
              </fieldset>
              <p className="muted small">No payment is collected. Your booking is saved in this local demo.</p>
            </form> : <div className="empty booking-placeholder"><h3>A room with your name on it.</h3><p>Choose an available room above to see your stay total and complete your booking.</p><a className="text-link" href="#rooms">Explore the rooms <span aria-hidden="true">&uarr;</span></a></div>}
          </section>

          <section id="bookings" className="bookings-section" aria-labelledby="bookings-title" aria-busy={bookingsLoading}>
            <div className="section-heading"><div><p className="eyebrow">ALL THE DETAILS, IN ONE PLACE</p><h2 id="bookings-title" ref={bookingsTitleRef} tabIndex={-1}>Current bookings.</h2></div><button className="secondary" disabled={busy || bookingsLoading} onClick={() => setRevision(value => value + 1)}>Refresh bookings</button></div>
            <p className="small muted">Shared workshop list. Edit dates or cancel a booking to release its room.</p>
            <div aria-live="polite" aria-atomic="true">{bookingNotice && <p className="success">{bookingNotice}</p>}</div>
            {bookingsLoading && <p className="empty" role="status">Loading your bookings...</p>}
            {bookingError && <div className="error" role="alert"><p>{bookingError}</p><button className="secondary" onClick={() => setRevision(value => value + 1)}>Retry bookings</button></div>}
            {!bookingsLoading && !bookingError && bookings.length === 0 && <p className="empty">No bookings yet. Find a room above and plan a little time away.</p>}
            {bookings.length > 0 && <ul className="booking-list">{bookings.map(booking => <li key={booking.id}>
                <div><span className="small muted">BOOKING #{booking.id}</span><h3>{booking.roomName}</h3><p>{booking.guestName} / {booking.guests} {booking.guests === 1 ? 'guest' : 'guests'}</p></div>
                <div><p>{formatDate(booking.checkIn)} &ndash; {formatDate(booking.checkOut)}</p><p className="muted">{nights(booking)} {nights(booking) === 1 ? 'night' : 'nights'} / <strong>{money(booking.totalPrice)} total</strong></p></div>
                {confirmCancel === booking.id ? <div className="cancel-confirm"><p>Cancel this booking?</p><button className="danger" disabled={busy} onClick={() => void cancel(booking)}>{busy ? 'Cancelling...' : 'Yes, cancel'}</button><button className="secondary" disabled={busy} onClick={() => setConfirmCancel(null)}>Keep stay</button></div>
                  : <div className="booking-actions">
                    <button className="secondary" id={`edit-booking-${booking.id}`} disabled={busy || (editingId !== null && editingId !== booking.id)} aria-expanded={editingId === booking.id}
                      aria-controls={editingId === booking.id ? `edit-form-${booking.id}` : undefined}
                      aria-label={`Edit dates for booking ${booking.id} for ${booking.roomName}`}
                      onClick={() => { if (editingId === booking.id) closeEditor(booking.id); else { setConfirmCancel(null); setEditingId(booking.id); setBookingNotice(''); setNotice('') } }}>Edit dates</button>
                    <button className="secondary" disabled={busy || editingId !== null} aria-label={`Cancel booking ${booking.id} for ${booking.roomName}`} onClick={() => { setBookingNotice(''); setConfirmCancel(booking.id) }}>Cancel booking</button>
                  </div>}
                {editingId === booking.id && <BookingDateEditor booking={booking} busy={busy} onBusyChange={setBusy} onClose={() => closeEditor(booking.id)} onSaved={bookingUpdated} />}
              </li>)}</ul>}
          </section>
        </div>
      </main>
      <footer className="wrap site-footer"><span className="wordmark">NORTHSTAR<span>HOTEL &amp; HARBOUR</span></span><p>A good place to pause.</p><span className="small">Local workshop demo / No payments</span></footer>
    </>
  )
}
