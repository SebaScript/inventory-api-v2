import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Item } from './item.entity';

@Entity('groups')
export class Group {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 'Electronics' })
  @Column({ length: 80, unique: true })
  name: string;

  @ApiProperty({ example: 'Consumer electronics', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Item, (item) => item.group)
  items?: Item[];
}
