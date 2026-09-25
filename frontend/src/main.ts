import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent, authInterceptor } from './app';

bootstrapApplication(AppComponent, { providers: [provideHttpClient(withInterceptors([authInterceptor]))] }).catch(console.error);
