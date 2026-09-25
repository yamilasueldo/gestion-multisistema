import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { AuthController, AuthService } from './auth';
import { BillingController, BillingService, ClientAuthGuard } from './billing';
import { AdminController, AdminJwtGuard } from './admin';
import { AdjustmentService, IndexSourceService } from './adjustments';
import { JobsService } from './jobs.service';
import { FilesController, MailQueueService, StorageService } from './support-services';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot()],
  controllers: [AuthController, BillingController, AdminController, FilesController],
  providers: [PrismaService, AuthService, ClientAuthGuard, AdminJwtGuard, BillingService, AdjustmentService, IndexSourceService, JobsService, StorageService, MailQueueService],
})
export class AppModule {}
