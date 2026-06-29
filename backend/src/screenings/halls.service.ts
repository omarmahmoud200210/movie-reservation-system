import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Hall } from '@prisma/client';
import { CreateHallDto } from './dto/create-hall.dto';
import { HallsRepository, HallWithSeats } from './halls.repository';

@Injectable()
export class HallsService {
  constructor(private readonly hallsRepo: HallsRepository) {}

  createHall(dto: CreateHallDto): Promise<HallWithSeats> {
    return this.hallsRepo.createHallWithSeats(dto);
  }

  async getHall(id: number): Promise<HallWithSeats> {
    const hall = await this.hallsRepo.findHallWithSeats(id);
    if (!hall) {
      throw new NotFoundException(`Hall ${id} not found`);
    }
    return hall;
  }

  listHalls(): Promise<Hall[]> {
    return this.hallsRepo.listHalls();
  }

  async deleteHall(id: number): Promise<Hall> {
    const hall = await this.hallsRepo.findHallWithSeats(id);
    if (!hall) {
      throw new NotFoundException(`Hall ${id} not found`);
    }
    if (await this.hallsRepo.hasReservations(id)) {
      throw new ConflictException(
        'Cannot delete a hall with existing reservations',
      );
    }
    return this.hallsRepo.deleteHall(id);
  }
}
