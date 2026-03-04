import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';
import { AttendanceService, DashboardData, RepeatAbsentee } from '../attendance.service';

@Component({
  selector:        'app-principal-dashboard',
  templateUrl:     './principal-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrincipalDashboardComponent implements OnInit {

  data:    DashboardData | null = null;
  loading: boolean              = true;
  error:   string               = '';

  constructor(
    private svc: AttendanceService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error   = '';
    this.cdr.markForCheck();

    this.svc.getDashboard().subscribe({
      next: data => {
        this.data    = data;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error   = 'Could not load dashboard. Tap to retry.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  trackByStudentId(_: number, a: RepeatAbsentee): string {
    return a.student_id;
  }
}
