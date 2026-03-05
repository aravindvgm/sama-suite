import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private readonly apiUrl = environment.apiUrl;

  private accessToken: string | null = null;
  private currentUserId: string | null = null;
  private currentOrgId: string | null = null;
  private currentRoles: string[] = [];

  constructor(private http: HttpClient) {}

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

    const url = `${this.apiUrl}/auth/refresh`;

    return this.http.post<{ token: string }>(
      url,
      {},
      { withCredentials: true }
    ).pipe(
      tap(res => this.setAccessToken(res.token)),
      map(res => res.token)
    );
  }

  // TOKEN HANDLING
  private setAccessToken(token: string): void {

    this.accessToken = token;

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
    this.accessToken = null;
    this.currentUserId = null;
    this.currentOrgId = null;
    this.currentRoles = [];
  }
}