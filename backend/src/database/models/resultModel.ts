import mongoose ,{ Schema, Document } from 'mongoose';

export interface Result extends Document {
    id: string;
    googleId?: string;
    driveFileId?: string;
    courseWorkId: string;
    score: number;
    studentId: string;
    remark:'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Very Poor';
    feedback: string;
    grade: string;
    status:"pending" | "completed"|"failed";
    studentName: string;
    studentEmail: string;
    createdAt: Date;
    updatedAt: Date;
}

const resultSchema = new Schema<Result>({
    googleId: { type: String, index: true },
    driveFileId: { type: String, index: true },
    courseWorkId: { ref:'CourseWork',type: String, required: true },
    score: { type: Number, required: true },
    studentId: { type: String, required: true },
    grade: { type: String, required: true },
    remark: { type: String, required: true },
    studentName: { type: String, required: true },
    studentEmail: { type: String, required: true },
    feedback: { type: String, required: true },
    status: { type: String, required: true , default:"pending"},
},{
    timestamps: true,
});

export default mongoose.model<Result>('Result',resultSchema);