import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsNotEmpty, IsPositive, IsString, ValidateNested } from 'class-validator';
import { UpdateAirplaneDto } from '../airplane/update-airplane.dto';
import { UpdateAirportDto } from '../airport/update-airport.dto';
import { UpdateCityDto } from '../city/update-city.dto';

/** RPC payload addressing one catalog entity (city, airport, airplane, flight, seat) by id. */
export class IdMessageDto {
  @IsInt()
  @IsPositive()
  id: number;
}

export class UpdateCityMessageDto extends IdMessageDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateCityDto)
  updateCityDto: UpdateCityDto;
}

export class UpdateAirportMessageDto extends IdMessageDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateAirportDto)
  updateAirportDto: UpdateAirportDto;
}

export class UpdateAirplaneMessageDto extends IdMessageDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateAirplaneDto)
  updateAirplaneDto: UpdateAirplaneDto;
}

export class AirportCodeMessageDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}

export class AirplaneSeatsMessageDto {
  @IsInt()
  @IsPositive()
  airplaneId: number;
}
