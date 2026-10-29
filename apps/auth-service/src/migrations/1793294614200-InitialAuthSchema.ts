import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline for auth_db (generated from the entities). Until now the schema only came from `synchronize` in development,
 * so on a database that already has the tables this adopts them instead of failing, adding only the users.role column
 * if it predates roles.
 */
export class InitialAuthSchema1793294614200 implements MigrationInterface {
  name = 'InitialAuthSchema1793294614200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('users')) {
      await queryRunner.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'users_role_enum') THEN
            CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'user', 'agent');
          END IF;
        END $$;
      `);
      await queryRunner.query(
        `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" "public"."users_role_enum" NOT NULL DEFAULT 'user'`,
      );
      return;
    }

    await queryRunner.query(
      `CREATE TABLE "notification_settings" ("id" SERIAL NOT NULL, "emailEnabled" boolean NOT NULL DEFAULT true, "smsEnabled" boolean NOT NULL DEFAULT false, "pushEnabled" boolean NOT NULL DEFAULT false, "securityAlerts" boolean NOT NULL DEFAULT true, "userId" integer, CONSTRAINT "REL_5a8ffc3b89343043c9440d631e" UNIQUE ("userId"), CONSTRAINT "PK_d131abd7996c475ef768d4559ba" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'user', 'agent')`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" SERIAL NOT NULL, "firstName" character varying(96) NOT NULL, "lastName" character varying(96), "email" character varying(96) NOT NULL, "password" character varying(96), "googleId" character varying, "lastLoginAt" TIMESTAMP, "lastLoginIp" character varying, "role" "public"."users_role_enum" NOT NULL DEFAULT 'user', "isActive" boolean NOT NULL DEFAULT true, "isLocked" boolean NOT NULL DEFAULT false, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_audit" ("id" SERIAL NOT NULL, "userId" integer, "ip" character varying(45), "deviceId" character varying(96), "event" character varying(64) NOT NULL, "success" boolean NOT NULL DEFAULT false, "refreshTokenId" character varying(64), "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4f9a93d6564ca73e717de59d4cc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_settings" ADD CONSTRAINT "FK_5a8ffc3b89343043c9440d631e2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notification_settings" DROP CONSTRAINT "FK_5a8ffc3b89343043c9440d631e2"`);
    await queryRunner.query(`DROP TABLE "auth_audit"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`DROP TABLE "notification_settings"`);
  }
}
