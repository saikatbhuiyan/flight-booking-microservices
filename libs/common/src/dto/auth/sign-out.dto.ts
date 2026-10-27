import { IsEnum, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { ClientType } from '@app/common';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';

export class SignOutDto {
  @ApiProperty({ example: 1, description: 'User ID' })
  @IsNumber()
  @IsPositive()
  userId: number;

  @ApiPropertyOptional({
    example: '1234',
    description: 'Unique device identifier',
  })
  @IsString()
  deviceId?: string = '1234';

  @ApiPropertyOptional({
    enum: ClientType,
    example: ClientType.WEB,
    description: 'Client platform type',
  })
  @IsEnum(ClientType)
  @IsOptional()
  clientType?: ClientType = ClientType.WEB;
}

/** Public logout body: the user is always taken from the access token, never from the request. */
export class LogoutRequestDto extends OmitType(SignOutDto, ['userId'] as const) {}
