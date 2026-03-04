import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DoCheck,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { EMPTY, Subject, TimeoutError } from 'rxjs';
import { catchError, takeUntil, timeout } from 'rxjs/operators';
import {
  AttendanceService,
  BulkRecord,
  ClassItem,
  RosterStudent,
  SectionItem,
} from '../attendance.service';

// ── Save state machine ────────────────────────────────────────────────────────

export enum SaveState {
  IDLE         = 'IDLE',
  SAVING       = 'SAVING',
  SAVE_SLOW    = 'SAVE_SLOW',    // timeout fired; request cancelled; retry available
  SAVE_SUCCESS = 'SAVE_SUCCESS',
  SAVE_ERROR   = 'SAVE_ERROR',
}

type SaveAction =
  | { type: 'START' }
  | { type: 'TIMEOUT' }
  | { type: 'SUCCESS'; saved: number }
  | { type: 'ERROR' }
  | { type: 'RESET' };

// ── Component ─────────────────────────────────────────────────────────────────

interface DisplayStudent extends RosterStudent {
  localStatus: 'PRESENT' | 'ABSENT';
}

@Component({
  selector:        'app-teacher-attendance',
  templateUrl:     './teacher-attendance.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeacherAttendanceComponent implements OnInit, OnDestroy, DoCheck {

  // ── Picker state ──────────────────────────────────────────────────────────
  classes:           ClassItem[]   = [];
  sections:          SectionItem[] = [];
  selectedClassId:   string        = '';
  selectedSectionId: string        = '';
  date:              string        = this.todayIso();

  // ── Roster state ──────────────────────────────────────────────────────────
  students:      DisplayStudent[] = [];
  loadingRoster: boolean          = false;
  rosterError:   string           = '';

  // ── Save state machine ────────────────────────────────────────────────────
  saveState:  SaveState = SaveState.IDLE;
  savedCount: number    = 0;
  /** Exposes the enum to the template for *ngIf comparisons. */
  readonly SS = SaveState;

  // ── VALIDATION INSTRUMENTATION ────────────────────────────────────────────
  // All fields prefixed _val_ — grep for "_val_" to remove before production.

  private _val_rosterStart = 0;
  private _val_rosterMs    = 0;

  private _val_tapStart   = 0;
  private _val_firstTapMs = 0;
  private _val_tapTimes: number[] = [];

  private _val_saveStart = 0;
  private _val_saveMs    = 0;

  private _val_wasOffline     = false;
  private _val_offlineHandler = (): void => { this._val_wasOffline = true; };
  private _val_onlineHandler  = (): void => {
    if (this._val_wasOffline) {
      console.log('ATTENDANCE VALIDATION: RETRY OCCURRED (navigator.onLine: offline → online)');
      this._val_wasOffline = false;
    }
  };

  // ── END VALIDATION INSTRUMENTATION ───────────────────────────────────────

  // ── CD AUDIT INSTRUMENTATION ──────────────────────────────────────────────
  // Grep key: _cd_audit_ — remove every line containing this marker.
  //
  // DIRTY  = markForCheck() was called; Angular will re-check this view.
  // CLEAN  = parent CD triggered a visit; view is skipped (OnPush working).
  //
  // OnPush compliance check for toggle():
  //   Expected — exactly 1 DIRTY cycle per tap, zero CLEAN cycles in same tick.
  //   Violation — CLEAN cycles appearing means AppComponent CD is propagating
  //   into this component without an explicit markForCheck() call.

  private _cd_cycleCount = 0;       // _cd_audit_
  private _cd_dirty      = false;   // _cd_audit_ — set true before every markForCheck
  private _cd_phase      = 'idle';  // _cd_audit_ — phase label for console context

  // ── END CD AUDIT INSTRUMENTATION ─────────────────────────────────────────

  /** Cached payload for retry — set on every _performSave call. */
  private _pendingRecords: BulkRecord[] | null = null;

  /** Completes on ngOnDestroy — unsubscribes all takeUntil-guarded streams. */
  private _destroy$ = new Subject<void>();

  constructor(
    private svc: AttendanceService,
    private cdr: ChangeDetectorRef,
  ) {
    console.log('CD_AUDIT: TeacherAttendanceComponent constructed — cycle counter reset'); // _cd_audit_
  }

  // ── CD AUDIT: ngDoCheck ───────────────────────────────────────────────────
  // Called by Angular on every CD pass for this component's host view,
  // regardless of OnPush. Fires even when the template will NOT be re-checked.
  ngDoCheck(): void {
    this._cd_cycleCount++;                                                           // _cd_audit_
    const kind = this._cd_dirty ? 'DIRTY' : 'CLEAN';                               // _cd_audit_
    console.log(`CD_CYCLE: ${this._cd_cycleCount} [${kind}] [${this._cd_phase}]`); // _cd_audit_
    this._cd_dirty = false;                                                          // _cd_audit_
  }
  // ── END CD AUDIT ─────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.svc.getClasses().pipe(takeUntil(this._destroy$)).subscribe({
      next: classes => {
        this.classes = classes;
        this._cd_phase = 'classes-load'; this._cd_dirty = true; // _cd_audit_
        this.cdr.markForCheck();
      },
      error: () => { /* classes load failure — show empty picker */ },
    });

    window.addEventListener('offline', this._val_offlineHandler);
    window.addEventListener('online',  this._val_onlineHandler);
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
    window.removeEventListener('offline', this._val_offlineHandler);
    window.removeEventListener('online',  this._val_onlineHandler);
  }

  onClassChange(classId: string): void {
    this.selectedClassId   = classId;
    this.selectedSectionId = '';
    this.students          = [];
    this.sections          = [];
    if (!classId) return;

    this.svc.getSections(classId).pipe(takeUntil(this._destroy$)).subscribe({
      next: sections => {
        this.sections = sections;
        this._cd_phase = 'sections-load'; this._cd_dirty = true; // _cd_audit_
        this.cdr.markForCheck();
      },
      error: () => { /* section load failure */ },
    });
  }

  onSectionChange(sectionId: string): void {
    this.selectedSectionId = sectionId;
    this.students          = [];
    if (!sectionId) return;
    this.loadRoster();
  }

  onDateChange(date: string): void {
    this.date = date;
    if (this.selectedSectionId) this.loadRoster();
  }

  loadRoster(): void {
    this._val_rosterStart = performance.now();
    this._val_rosterMs    = 0;
    this._val_tapTimes    = [];
    this._val_firstTapMs  = 0;

    this._cd_phase = 'roster-fetch'; // _cd_audit_
    this.loadingRoster = true;
    this.rosterError   = '';
    this.students      = [];
    this._cd_dirty = true; // _cd_audit_
    this.cdr.markForCheck();

    this.svc.getSectionRoster(this.selectedSectionId, this.date)
      .pipe(takeUntil(this._destroy$))
      .subscribe({
      next: roster => {
        this.students = roster.students.map(s => ({
          ...s,
          localStatus: (s.status === 'ABSENT' ? 'ABSENT' : 'PRESENT') as 'PRESENT' | 'ABSENT',
        }));
        this.loadingRoster = false;
        this._cd_phase = 'roster-done'; this._cd_dirty = true; // _cd_audit_
        this.cdr.markForCheck();

        requestAnimationFrame(() => {
          this._val_rosterMs = Math.round(performance.now() - this._val_rosterStart);
          console.log(`ATTENDANCE VALIDATION: Roster Load = ${this._val_rosterMs} ms`);
        });
      },
      error: () => {
        this.rosterError   = 'Could not load students. Tap to retry.';
        this.loadingRoster = false;
        this._cd_phase = 'roster-error'; this._cd_dirty = true; // _cd_audit_
        this.cdr.markForCheck();
      },
    });
  }

  toggle(student: DisplayStudent): void {
    this._val_tapStart = performance.now();

    this._cd_phase = 'toggle'; // _cd_audit_
    student.localStatus = student.localStatus === 'PRESENT' ? 'ABSENT' : 'PRESENT';
    this._cd_dirty = true; // _cd_audit_
    this.cdr.markForCheck();

    requestAnimationFrame(() => {
      const elapsed = Math.round(performance.now() - this._val_tapStart);
      this._val_tapTimes.push(elapsed);
      if (this._val_tapTimes.length === 1) {
        this._val_firstTapMs = elapsed;
        console.log(`ATTENDANCE VALIDATION: First Tap = ${elapsed} ms`);
      }
    });
  }

  get presentCount(): number {
    return this.students.filter(s => s.localStatus === 'PRESENT').length;
  }

  get absentCount(): number {
    return this.students.filter(s => s.localStatus === 'ABSENT').length;
  }

  // ── Save state machine — public API ──────────────────────────────────────

  save(): void {
    if (this.students.length === 0) return;
    const records: BulkRecord[] = this.students.map(s => ({
      studentId:    s.student_id,
      enrollmentId: s.enrollment_id,
      status:       s.localStatus,
    }));
    this._performSave(records);
  }

  /**
   * Retry using the payload captured at the time of the last save() call.
   * Only callable from SAVE_SLOW or SAVE_ERROR — the template enforces this
   * via structural directives, but we guard here too for safety.
   */
  retry(): void {
    if (
      this.saveState !== SaveState.SAVE_SLOW &&
      this.saveState !== SaveState.SAVE_ERROR
    ) return;
    if (!this._pendingRecords) return;
    this._performSave(this._pendingRecords);
  }

  // ── Save state machine — internals ────────────────────────────────────────

  /**
   * Pure reducer: given current state + action, returns next state.
   * No side effects. Illegal transitions return the current state unchanged.
   *
   * Transition table:
   *   IDLE / SAVE_SLOW / SAVE_SUCCESS / SAVE_ERROR  + START   → SAVING
   *   SAVING                                         + START   → SAVING  (no-op, guard)
   *   SAVING                                         + TIMEOUT → SAVE_SLOW
   *   SAVING                                         + SUCCESS → SAVE_SUCCESS
   *   SAVING                                         + ERROR   → SAVE_ERROR
   *   any                                            + RESET   → IDLE
   *   any other combination                                    → unchanged
   */
  private _reduceSaveState(state: SaveState, action: SaveAction): SaveState {
    switch (action.type) {
      case 'START':
        // Absorb duplicate START while in-flight; all other states advance to SAVING.
        return state === SaveState.SAVING ? state : SaveState.SAVING;
      case 'TIMEOUT':
        return state === SaveState.SAVING ? SaveState.SAVE_SLOW    : state;
      case 'SUCCESS':
        return state === SaveState.SAVING ? SaveState.SAVE_SUCCESS : state;
      case 'ERROR':
        return state === SaveState.SAVING ? SaveState.SAVE_ERROR   : state;
      case 'RESET':
        return SaveState.IDLE;
    }
  }

  /**
   * Apply a save action: compute next state via the reducer, update saveState,
   * and call markForCheck only when the state actually changed.
   * All save-related CD cycles originate here — no other code calls markForCheck
   * for save operations.
   */
  private _applyAction(action: SaveAction): void {
    const next = this._reduceSaveState(this.saveState, action);
    if (next === this.saveState) return; // reducer rejected this transition — no-op
    if (action.type === 'SUCCESS') this.savedCount = action.saved;
    this.saveState = next;
    this._cd_phase = `save-${action.type.toLowerCase()}`; // _cd_audit_
    this._cd_dirty = true;                                 // _cd_audit_
    this.cdr.markForCheck();
  }

  /**
   * Execute a bulk save request.
   * Caches the payload for retry.
   * Guards against concurrent in-flight requests.
   * Timeout at 10 s → SAVE_SLOW (not SAVE_ERROR); the original request is
   * cancelled client-side. The backend UPSERT is idempotent, so retry is safe.
   */
  private _performSave(records: BulkRecord[]): void {
    if (this.saveState === SaveState.SAVING) return; // request already in-flight

    this._pendingRecords = records; // cache before the HTTP call
    this._val_saveStart  = performance.now();
    this._val_saveMs     = 0;

    this._applyAction({ type: 'START' });

    this.svc.bulkMark(this.selectedSectionId, this.date, records)
      .pipe(
        timeout(10_000),
        catchError(err => {
          if (err instanceof TimeoutError) {
            // Slow path: request timed out — offer retry, do not show hard error.
            this._applyAction({ type: 'TIMEOUT' });
          } else {
            // Hard error: network failure, server 4xx/5xx.
            this._applyAction({ type: 'ERROR' });
          }
          return EMPTY; // swallow; subscribe's error handler is never called
        }),
        takeUntil(this._destroy$),
      )
      .subscribe({
        next: result => {
          this._applyAction({ type: 'SUCCESS', saved: result.saved });
          requestAnimationFrame(() => {
            this._val_saveMs = Math.round(performance.now() - this._val_saveStart);
            this._val_printSummary();
          });
        },
        // No error handler — catchError above converts all errors to EMPTY.
      });
  }

  // ─────────────────────────────────────────────────────────────────────────

  trackByClassId(_: number, c: ClassItem): string {
    return c.id;
  }

  trackBySectionId(_: number, s: SectionItem): string {
    return s.id;
  }

  trackByStudentId(_: number, s: DisplayStudent): string {
    return s.student_id;
  }

  // ── VALIDATION: Ctrl+Shift+V → print summary ──────────────────────────────

  @HostListener('window:keydown', ['$event'])
  _val_onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.shiftKey && event.key === 'V') {
      this._val_printSummary();
    }
  }

  private _val_printSummary(): void {
    const tapCount = this._val_tapTimes.length;
    const avgTap   = tapCount
      ? Math.round(this._val_tapTimes.reduce((a, b) => a + b, 0) / tapCount)
      : 0;

    const rosterStatus = this._val_rosterMs === 0 ? '(not yet loaded)'
      : this._val_rosterMs < 1200  ? 'PASS'  : 'INVESTIGATE';
    const firstTapStatus = this._val_firstTapMs === 0 ? '(no taps yet)'
      : this._val_firstTapMs < 100 ? 'PASS'  : 'INVESTIGATE';
    const avgTapStatus = tapCount === 0 ? '(no taps yet)'
      : avgTap < 100               ? 'PASS'  : 'INVESTIGATE';
    const saveStatus = this._val_saveMs === 0 ? '(not yet saved)'
      : this._val_saveMs < 800     ? 'PASS'
      : this._val_saveMs < 1200    ? 'ACCEPTABLE'
      :                              'INVESTIGATE';

    console.log([
      '',
      '═════════════════════════════════════════',
      'ATTENDANCE VALIDATION',
      '─────────────────────────────────────────',
      `Roster Load   = ${this._val_rosterMs} ms        [${rosterStatus}]   threshold < 1200ms`,
      `First Tap     = ${this._val_firstTapMs} ms       [${firstTapStatus}]   threshold < 100ms`,
      `Average Tap   = ${avgTap} ms       [${avgTapStatus}]   threshold < 100ms  (${tapCount} taps)`,
      `Bulk Save     = ${this._val_saveMs} ms        [${saveStatus}]   ideal < 800ms / acceptable < 1200ms`,
      '─────────────────────────────────────────',
      'NOTE: Timings include requestAnimationFrame frame wait (~16ms).',
      'Subtract 16ms from tap values for pure Angular CD time.',
      '═════════════════════════════════════════',
      '',
    ].join('\n'));
  }

  // ── END VALIDATION INSTRUMENTATION ───────────────────────────────────────

  private todayIso(): string {
    return new Date().toISOString().split('T')[0];
  }
}
