import { Exclude } from 'class-transformer';
import { Entity, PrimaryGeneratedColumn, Column, Unique, OneToOne } from 'typeorm';
import { Role } from '@app/common';
import { NotificationSettings } from './notification-settings.entity';

@Entity('users')
@Unique(['email'])
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 96 })
  firstName: string;

  @Column({ length: 96, nullable: true })
  lastName?: string;

  @Column({ length: 96 })
  email: string;

  @Column({ length: 96, nullable: true })
  @Exclude()
  password?: string;

  @Column({ nullable: true })
  @Exclude()
  googleId?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date;

  @Column({ nullable: true })
  lastLoginIp: string;

  /** Authoritative role; the gateway reads it via auth.validate on every request. Promote admins out of band. */
  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role: Role;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isLocked: boolean;

  @OneToOne(() => NotificationSettings, (settings) => settings.user)
  notificationSettings: NotificationSettings;
}
