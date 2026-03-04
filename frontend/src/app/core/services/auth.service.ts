import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  /** Access token stored in memory only */
  private accessToken: string | null = null;
  private currentUserId: string | null = null;
  private currentOrgId: string | null = null;
  private currentRoles: string[] = [];

  constructor(private http: HttpClient) {}

  // --------------------------------------------------
  // LOGIN
  // --------------------------------------------------

  login(payload: {
    organizationId: string;
    email: string;
    password: string;
  }): Observable<string> {
    return this.http.post<{ token: string }>(
      '/auth/login',
      payload,
      { withCredentials: true }
    ).pipe(
      tap(response => {
        this.setAccessToken(response.token);
      }),
      map(response => response.token)
    );
  }

  // --------------------------------------------------
  // REFRESH TOKEN
  // --------------------------------------------------

  refreshToken(): Observable<string> {
    return this.http.post<{ token: string }>(
      '/auth/refresh',
      {},
      { withCredentials: true }
    ).pipe(
      tap(response => {
        this.setAccessToken(response.token);
      }),
      map(response => response.token)
    );
  }

  // --------------------------------------------------
  // TOKEN HANDLING
  // --------------------------------------------------

  setAccessToken(token: string): void {
    this.accessToken = token;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));

      this.currentUserId = payload?.sub ?? null;
      this.currentOrgId = payload?.organizationId ?? null;

      if (payload?.role) {
        this.currentRoles = [payload.role];
      } else {
        this.currentRoles = [];
      }

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

  // --------------------------------------------------
  // LOGOUT
  // --------------------------------------------------

  logout(): void {
    this.accessToken = null;
    this.currentUserId = null;
    this.currentOrgId = null;
    this.currentRoles = [];
  }
}