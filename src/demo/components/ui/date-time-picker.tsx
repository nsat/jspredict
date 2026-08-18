import * as React from "react"
import { format } from "date-fns"
import { ChevronDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/**
 * shadcn "Time Picker" pattern: a Popover + Calendar for the date paired with a
 * native time input for the time.
 *
 * The component is timezone-agnostic — it operates on a plain `Date` whose
 * fields represent the intended *wall-clock* (year/month/day + h/m/s). The
 * parent converts that wall-clock to/from an absolute instant for whatever
 * timezone it wants to display.
 */
export function DateTimePicker({
  value,
  onChange,
  timeLabel,
}: {
  /** A Date whose wall-clock fields are the values to display/edit. */
  value: Date
  /** Called with a new wall-clock Date when the user picks a date or time. */
  onChange: (next: Date) => void
  /** Optional suffix for the time field label (e.g. a timezone identifier). */
  timeLabel?: string
}) {
  const [open, setOpen] = React.useState(false)

  function handleDateSelect(date: Date | undefined) {
    if (!date) return
    const next = new Date(value)
    next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate())
    onChange(next)
  }

  function handleTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const [h, m, s] = e.target.value.split(":")
    const next = new Date(value)
    next.setHours(Number(h ?? 0), Number(m ?? 0), Number(s ?? 0), 0)
    onChange(next)
  }

  return (
    <>
      <Field>
        <FieldLabel htmlFor="date-picker">Start Date</FieldLabel>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id="date-picker"
              variant="outline"
              className="w-full justify-between bg-transparent font-normal"
            >
              {format(value, "PPP")}
              <ChevronDownIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto overflow-hidden p-0" align="start">
            <Calendar
              mode="single"
              selected={value}
              captionLayout="dropdown"
              defaultMonth={value}
              onSelect={(date) => {
                handleDateSelect(date)
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
      </Field>
      <Field>
        <FieldLabel htmlFor="time-picker">
          Start Time
        </FieldLabel>
        <Input
          type="time"
          id="time-picker"
          step="1"
          value={format(value, "HH:mm:ss")}
          onChange={handleTimeChange}
          className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        />
      </Field>
    </>
  )
}
