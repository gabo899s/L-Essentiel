import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils'; 

interface DeliverySchedulerProps {
  initialDate?: Date;
  timeSlots: string[];
  timeZone: string;
  onSchedule: (dateTime: { date: Date; time: string }) => void;
  className?: string;
  onCancel?: () => void;
}

const scheduleButtonVariants = cva(
  'relative isolate inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-transparent text-foreground hover:bg-muted border border-border',
        selected: 'text-primary-foreground border-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const getWeekDays = (startDate: Date): Date[] => {
  const days: Date[] = [];
  const startOfWeek = new Date(startDate);
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
  startOfWeek.setDate(diff);

  for (let i = 0; i < 6; i++) {
    const nextDay = new Date(startOfWeek);
    nextDay.setDate(startOfWeek.getDate() + i);
    days.push(nextDay);
  }
  return days;
};

export const DeliveryScheduler: React.FC<DeliverySchedulerProps> = ({
  initialDate = new Date(),
  timeSlots,
  timeZone,
  onSchedule,
  onCancel,
  className,
}) => {
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate);
  const [selectedTime, setSelectedTime] = useState<string | null>(timeSlots[0] || null);
  
  const weekDays = getWeekDays(currentDate);
  const monthYear = currentDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long' });

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
  };
  
  const handleTimeSelect = (time: string) => {
    setSelectedTime(time);
  };

  const changeWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    setCurrentDate(newDate);
  };
  
  const handleSchedule = () => {
    if (selectedDate && selectedTime) {
      onSchedule({ date: selectedDate, time: selectedTime });
    }
  };

  return (
    <div className={cn('w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 text-ink shadow-lg', className)}>
      <div className="space-y-6">
        <div>
          <label className="text-[0.65rem] uppercase tracking-widest text-ink-light">Ventana de Entrega*</label>
          <div className="mt-2 flex items-center justify-between">
            <h3 className="font-semibold capitalize">{monthYear}</h3>
            <div className="flex items-center space-x-2">
              <button onClick={() => changeWeek('prev')} className="rounded-md p-1 hover:bg-black/5">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button onClick={() => changeWeek('next')} className="rounded-md p-1 hover:bg-black/5">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-2">
          {weekDays.map((day) => {
            const isSelected = selectedDate.toDateString() === day.toDateString();
            return (
              <div key={day.toISOString()} className="relative flex flex-col items-center">
                <span className="mb-2 text-xs text-muted-foreground">
                  {day.toLocaleDateString('es-ES', { weekday: 'short' })}
                </span>
                <button
                  onClick={() => handleDateSelect(day)}
                  className={cn(scheduleButtonVariants({ variant: isSelected ? 'selected' : 'default' }), 'h-10 w-10 border border-black/10')}
                >
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        layoutId="date-selector"
                        className="absolute inset-0 z-0 rounded-lg bg-black cursor-pointer"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                      />
                    )}
                  </AnimatePresence>
                  <span className={cn("relative z-10", isSelected ? "text-white" : "text-ink")}>{day.getDate()}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div>
          <p className="text-sm font-medium">{timeZone}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {timeSlots.map((time) => {
              const isSelected = selectedTime === time;
              return (
                <button
                  key={time}
                  onClick={() => handleTimeSelect(time)}
                  className={cn(scheduleButtonVariants({ variant: isSelected ? 'selected' : 'default' }), 'border border-black/10')}
                >
                   <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        layoutId="time-selector"
                        className="absolute inset-0 z-0 rounded-lg bg-black"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                      />
                    )}
                  </AnimatePresence>
                  <span className={cn("relative z-10", isSelected ? "text-white" : "text-ink")}>{time}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-4 border-black/5 mt-4">
           {onCancel ? (
             <button onClick={onCancel} className={cn(scheduleButtonVariants({variant: 'default'}), 'px-6 border-none hover:bg-black/5')}>Cancelar</button>
           ) : <span/>}
           <button onClick={handleSchedule} className={cn(scheduleButtonVariants({variant: 'selected'}), 'px-6 bg-black text-white hover:bg-black/80 border-none')}>Agendar</button>
        </div>
      </div>
    </div>
  );
};
