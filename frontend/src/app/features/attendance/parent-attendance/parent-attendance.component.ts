import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AttendanceService, AttendanceDay } from '../attendance.service';

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present',
  ABSENT:  'Absent',
  LATE:    'Late',
  EXCUSED: 'Excused',
};

@Component({
  selector:        'app-parent-attendance',
  templateUrl:     './parent-attendance.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParentAttendanceComponent implements OnInit {

  studentId: string    = '';
  days:      AttendanceDay[] = [];
  loading:   boolean   = true;
  error:     string    = '';

  constructor(
    private route: ActivatedRoute,
    private svc:   AttendanceService,
    private cdr:   ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.studentId = this.route.snapshot.paramMap.get('studentId') ?? '';
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error   = '';
    this.cdr.markForCheck();

    this.svc.getStudentHistory(this.studentId).subscribe({
      next: days => {
        this.days    = days;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error   = 'Could not load attendance. Tap to retry.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  get today(): AttendanceDay | null {
    const todayStr = new Date().toISOString().split('T')[0];
    return this.days.find(d => d.attendance_date === todayStr) ?? null;
  }

  get history(): AttendanceDay[] {
    const todayStr = new Date().toISOString().split('T')[0];
    return this.days.filter(d => d.attendance_date !== todayStr);
  }

  label(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  formatDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  trackByDate(_: number, d: AttendanceDay): string {
    return d.attendance_date;
  }
}
