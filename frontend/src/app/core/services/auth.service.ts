import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private readonly apiUrl = environment.apiUrl;
  private readonly tokenStorageKey = 'sama_suite_access_token';

  private accessToken: string | null = null;
  private currentUserId: string | null = null;
  private currentOrgId: string | null = null;
  private currentRoles: string[] = [];

  constructor(private http: HttpClient) {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(this.tokenStorageKey);
        if (stored) {
          this.setAccessToken(stored);
        }
      }
    } catch {
      /* localStorage unavailable */
    }
  }

  // LOGIN
  login(payload: {
    organizationId: string;
    email: string;
    password: string;
  }): Observable<string> {

    const url = `${this.apiUrl}/auth/login`;

    return this.http.post<{ token: string }>(
      url,
      payload,
      { withCredentials: true }
    ).pipe(
      tap(res => this.setAccessToken(res.token)),
      map(res => res.token)
    );
  }

  // REFRESH TOKEN
  refreshToken(): Observable<string> {
    /* POST to /auth/refresh temporarily disabled — no HTTP:
    const url = `${this.apiUrl}/auth/refresh`;

    return this.http.post<{ token: string }>(
      url,
      {},
      { withCredentials: true }
    ).pipe(
      tap(res => this.setAccessToken(res.token)),
      map(res => res.token)
    );
    */
    return throwError(() => new Error('REFRESH_DISABLED'));
  }

  // TOKEN HANDLING
  private setAccessToken(token: string): void {

    this.accessToken = token;

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.tokenStorageKey, token);
      }
    } catch {
      /* quota / private mode */
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));

      this.currentUserId = payload?.sub ?? null;
      this.currentOrgId = payload?.organizationId ?? null;

      this.currentRoles = payload?.role ? [payload.role] : [];

    } catch {
      this.currentUserId = null;
      this.currentOrgId = null;
      this.currentRoles = [];
    }
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getCurrentUserId(): string | null {
    return this.currentUserId;
  }

  getCurrentOrgId(): string | null {
    return this.currentOrgId;
  }

  getRoles(): string[] {
    return this.currentRoles;
  }

  hasRole(role: string): boolean {
    return this.currentRoles.includes(role);
  }

  logout(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.tokenStorageKey);
      }
    } catch {
      /* ignore */
    }
    this.accessToken = null;
    this.currentUserId = null;
    this.currentOrgId = null;
    this.currentRoles = [];
  }
}